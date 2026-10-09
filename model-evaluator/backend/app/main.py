"""FastAPI app: REST API for models, suites, runs, blind review, AI judging and stats."""
import os
import random
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db, library, podcasts, providers, runner, stats
from .runner import new_id, now
from .schemas import (FolderImportIn, HumanScoresIn, JudgeConfig, LibraryDocIn, ModelConfig, PodcastImportIn, RunCreate,
                      SettingsIn, Suite)
from .seed import seed_if_empty, seed_templates


def load_dotenv() -> None:
    """Minimal .env loader (model-evaluator/.env or backend/.env); real env vars win."""
    here = Path(__file__).resolve().parent.parent
    for f in (here.parent / ".env", here / ".env"):
        if f.is_file():
            for line in f.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.conn()
    seed_if_empty()
    seed_templates()
    for doc in db.all_docs("library"):
        if doc.get("status") == "processing":
            doc.update(status="error", error="Interrupted by a restart; import it again.")
            library.save(doc)
    # Runs interrupted by a restart: mark them so the UI offers "resume".
    for run in db.all_docs("runs"):
        if run.get("status") in ("queued", "generating"):
            runner.update_run(run["id"], status="interrupted")
        if run.get("judge_status") == "running":
            runner.update_run(run["id"], judge_status="interrupted")
        if run.get("meta_status") == "running":
            runner.update_run(run["id"], meta_status="idle")
    yield


app = FastAPI(title="Model Evaluator", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _404(what: str):
    raise HTTPException(404, f"{what} not found")


# ---------------- settings / API keys ----------------

@app.get("/api/settings")
def get_settings():
    out = {}
    for name in providers.ALL_KEYS:
        stored = db.get_setting(name)
        val = providers.resolve_key(name)
        out[name] = {"set": bool(val), "source": "settings" if stored else ("env" if val else None),
                     "preview": f"…{val[-4:]}" if val else None}
    return {"keys": out, "judge_models": ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite", "mock-judge"],
            "voice_folder": db.get_setting("VOICE_FOLDER") or library.DEFAULT_VOICE_FOLDER,
            "transcribe_model": db.get_setting("TRANSCRIBE_MODEL") or "gemini-3.8-flash"}


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    for k, v in body.keys.items():
        if not k.replace("_", "").isalnum() or not k.isupper():
            raise HTTPException(400, f"Bad key name {k}")
        db.set_setting(k, v.strip() if v else None)
    return get_settings()


# ---------------- personal library (voice notes, podcasts, documents) ----------------

@app.get("/api/library")
def list_library(kind: str | None = None):
    docs = [d for d in db.all_docs("library") if not kind or d["kind"] == kind]
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    return [library.summary(d) for d in docs]


@app.get("/api/library/{doc_id}")
def get_doc(doc_id: str):
    return db.get("library", doc_id) or _404("Document")


@app.post("/api/library")
def create_doc(body: LibraryDocIn):
    extra = {"source": body.source}
    if body.created_at:
        extra["created_at"] = body.created_at
    doc = library.make_doc(body.kind, body.title, body.text.strip(), **extra)
    if body.kind == "podcast":
        segs = library.parse_speaker_lines(body.text)
        if any(s["speaker"] for s in segs):
            doc["segments"] = segs
    return library.summary(library.save(doc))


@app.put("/api/library/{doc_id}")
def update_doc(doc_id: str, body: LibraryDocIn):
    doc = db.get("library", doc_id) or _404("Document")
    doc.update(kind=body.kind, title=body.title, text=body.text)
    if doc.get("segments"):
        doc["segments"] = library.parse_speaker_lines(body.text)
    return library.summary(library.save(doc))


@app.post("/api/library/{doc_id}/speakers")
def rename_speakers(doc_id: str, mapping: dict[str, str]):
    """Rename diarized speakers, e.g. {"SPEAKER_00": "Travis"}."""
    doc = db.get("library", doc_id) or _404("Document")
    segs = [{**s, "speaker": (mapping.get(s["speaker"]) or s["speaker"]).strip() if s.get("speaker") else None}
            for s in doc.get("segments") or []]
    doc["segments"] = library.merge_segments(segs)
    doc["text"] = library.segments_to_text(doc["segments"])
    return library.save(doc)


@app.delete("/api/library/{doc_id}")
def delete_doc(doc_id: str):
    db.delete("library", doc_id)
    return {"ok": True}


@app.post("/api/library/import-folder")
def import_folder(body: FolderImportIn):
    try:
        return library.import_folder(body.path or db.get_setting("VOICE_FOLDER") or library.DEFAULT_VOICE_FOLDER)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/podcasts/search")
async def podcast_search(q: str):
    try:
        return await podcasts.search(q)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Podcast search failed: {e}")


@app.get("/api/podcasts/episodes")
async def podcast_episodes(feed_url: str):
    try:
        return await podcasts.episodes(feed_url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Could not read feed: {e}")


@app.post("/api/podcasts/import")
async def podcast_import(body: PodcastImportIn):
    doc = library.make_doc("podcast", "Fetching episode…", status="processing",
                           meta={"feed_url": body.feed_url, "guid": body.episode_guid, "step": "fetching feed"})
    library.save(doc)
    runner.spawn(doc["id"], podcasts.import_episode(doc["id"], body.feed_url, body.episode_guid, body.mode))
    return library.summary(doc)


# ---------------- models ----------------

@app.get("/api/models")
def list_models():
    return sorted(db.all_docs("models"), key=lambda m: m["label"].lower())


@app.post("/api/models")
def create_model(m: ModelConfig):
    doc = m.model_dump()
    doc["id"] = new_id("m")
    return db.put("models", doc)


@app.put("/api/models/{mid}")
def update_model(mid: str, m: ModelConfig):
    if not db.get("models", mid):
        _404("Model")
    doc = m.model_dump()
    doc["id"] = mid
    return db.put("models", doc)


@app.delete("/api/models/{mid}")
def delete_model(mid: str):
    db.delete("models", mid)
    return {"ok": True}


@app.post("/api/models/{mid}/test")
async def test_model(mid: str):
    m = db.get("models", mid) or _404("Model")
    try:
        comp = await providers.complete(
            provider=m["provider"], model=m["model"], prompt="Reply with exactly: OK", temperature=m.get("temperature"),
            max_tokens=min(256, m.get("max_tokens", 256)), base_url=m.get("base_url"),
            api_key=providers.key_for(m["provider"], m.get("api_key_env")))
        return {"ok": True, "output": comp.text[:200], "input_tokens": comp.input_tokens, "output_tokens": comp.output_tokens}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:500]}


# ---------------- suites ----------------

@app.get("/api/suites")
def list_suites():
    return sorted(db.all_docs("suites"), key=lambda s: s["name"].lower())


@app.get("/api/suites/{sid}")
def get_suite(sid: str):
    return db.get("suites", sid) or _404("Suite")


def _validate_suite(s: Suite):
    ids = [c.id for c in s.criteria]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "Criterion ids must be unique")
    cids = [c.id for c in s.cases]
    if len(cids) != len(set(cids)):
        raise HTTPException(400, "Case ids must be unique")


@app.post("/api/suites")
def create_suite(s: Suite):
    _validate_suite(s)
    doc = s.model_dump()
    doc["id"] = new_id("s")
    return db.put("suites", doc)


@app.put("/api/suites/{sid}")
def update_suite(sid: str, s: Suite):
    if not db.get("suites", sid):
        _404("Suite")
    _validate_suite(s)
    doc = s.model_dump()
    doc["id"] = sid
    return db.put("suites", doc)


@app.delete("/api/suites/{sid}")
def delete_suite(sid: str):
    db.delete("suites", sid)
    return {"ok": True}


# ---------------- runs ----------------

def public_run(run: dict) -> dict:
    """Strip model identities unless the run has been revealed."""
    out = {k: v for k, v in run.items() if k not in ("slots", "docs")}
    out["doc_titles"] = {i: {"title": d["title"], "kind": d["kind"]} for i, d in (run.get("docs") or {}).items()}
    out["slots"] = [
        {"slot": s["slot"], **({"label": s["model"]["label"], "provider": s["model"]["provider"],
                                "model": s["model"]["model"]} if run["revealed"] else {})}
        for s in run["slots"]
    ]
    out["busy"] = runner.is_busy(run["id"])
    return out


@app.get("/api/runs")
def list_runs():
    runs = sorted(db.all_docs("runs"), key=lambda r: r["created_at"], reverse=True)
    out = []
    for r in runs:
        p = public_run(r)
        p["suite"] = {"id": r["suite"]["id"], "name": r["suite"]["name"], "cases": len(r["suite"]["cases"])}
        out.append(p)
    return out


@app.post("/api/runs")
async def create_run(req: RunCreate):
    try:
        run = runner.create_run(req)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return public_run(run)


@app.get("/api/runs/{rid}")
def get_run(rid: str):
    return public_run(db.get("runs", rid) or _404("Run"))


@app.delete("/api/runs/{rid}")
def delete_run(rid: str):
    if runner.is_busy(rid):
        raise HTTPException(409, "Run is still in progress")
    db.delete("runs", rid)
    return {"ok": True}


@app.post("/api/runs/{rid}/resume")
async def resume_run(rid: str, retry_errors: bool = True):
    db.get("runs", rid) or _404("Run")
    if runner.is_busy(rid):
        raise HTTPException(409, "Run is busy")
    runner.spawn(rid, runner.execute_run(rid, retry_errors=retry_errors))
    return {"ok": True}


@app.post("/api/runs/{rid}/judge")
async def judge_run(rid: str, cfg: JudgeConfig | None = None):
    run = db.get("runs", rid) or _404("Run")
    if runner.is_busy(rid):
        raise HTTPException(409, "Run is busy")
    if cfg:
        runner.update_run(rid, judge={**cfg.model_dump(), "enabled": True})
    elif not run["judge"].get("enabled"):
        runner.update_run(rid, judge={**run["judge"], "enabled": True})
    runner.spawn(rid, runner.run_judge(rid))
    return {"ok": True}


@app.post("/api/runs/{rid}/meta-review")
async def meta_review(rid: str):
    db.get("runs", rid) or _404("Run")
    if runner.is_busy(rid):
        raise HTTPException(409, "Run is busy")
    runner.spawn(rid, runner.run_meta_review(rid))
    return {"ok": True}


@app.post("/api/runs/{rid}/reveal")
def reveal(rid: str):
    db.get("runs", rid) or _404("Run")
    return public_run(runner.update_run(rid, revealed=True, revealed_at=now()))


@app.post("/api/runs/{rid}/hide")
def hide(rid: str):
    db.get("runs", rid) or _404("Run")
    return public_run(runner.update_run(rid, revealed=False))


@app.get("/api/runs/{rid}/review")
def review(rid: str, include_ai: bool = False):
    """Blind review units: one per (case, sample), responses shuffled, identities hidden."""
    run = db.get("runs", rid) or _404("Run")
    gens = db.generations_for_run(rid)
    scores = db.scores_for_run(rid)
    by_gen: dict[str, dict] = {}
    for s in scores:
        if s["source"] == "ai" and not include_ai:
            continue
        by_gen.setdefault(s["generation_id"], {}).setdefault(s["source"], {})[s["criterion_id"]] = {
            "score": s["score"], "note": s.get("note"), "rationale": s.get("rationale")}
    units: dict[tuple, list] = {}
    for g in gens:
        units.setdefault((g["case_id"], g["sample"]), []).append(g)
    case_order = {c["id"]: i for i, c in enumerate(run["suite"]["cases"])}
    out = []
    for (case_id, sample), items in sorted(units.items(), key=lambda kv: (case_order.get(kv[0][0], 0), kv[0][1])):
        items.sort(key=lambda g: g["slot"])
        random.Random(f"{run['seed']}-{case_id}-{sample}").shuffle(items)
        rendered = []
        for i, g in enumerate(items):
            per_case = run["blind_mode"] == "per_case"
            item = {
                "generation_id": g["id"],
                "display_label": f"Response {i + 1}" if per_case else f"Model {g['slot']}",
                "slot": g["slot"] if (not per_case or run["revealed"]) else None,
                "status": g["status"], "output": g.get("output"), "error": g.get("error"),
                "latency_ms": g.get("latency_ms"), "output_tokens": g.get("output_tokens"),
                "checks": g.get("checks", []),
                "human": by_gen.get(g["id"], {}).get("human", {}),
                "ai": by_gen.get(g["id"], {}).get("ai", {}) if include_ai else None,
            }
            if run["revealed"]:
                m = next(s["model"] for s in run["slots"] if s["slot"] == g["slot"])
                item["model_label"] = m["label"]
            rendered.append(item)
        out.append({"case_id": case_id, "sample": sample, "items": rendered})
    return {"units": out}


@app.get("/api/runs/{rid}/docs/{doc_id}")
def run_doc(rid: str, doc_id: str):
    """The exact document snapshot a run used (survives later edits/deletes in the library)."""
    run = db.get("runs", rid) or _404("Run")
    return (run.get("docs") or {}).get(doc_id) or _404("Document")


@app.post("/api/runs/{rid}/scores")
def save_scores(rid: str, body: HumanScoresIn):
    run = db.get("runs", rid) or _404("Run")
    crit = {c["id"]: c for c in run["suite"]["criteria"]}
    gen_ids = {g["id"] for g in db.generations_for_run(rid)}
    for s in body.scores:
        c = crit.get(s.criterion_id)
        if not c or s.generation_id not in gen_ids:
            raise HTTPException(400, "Unknown generation or criterion")
        lo = 0 if c["scale_max"] == 1 else 1
        if not lo <= s.score <= c["scale_max"]:
            raise HTTPException(400, f"Score for {c['name']} must be between {lo} and {c['scale_max']}")
        db.put_score({"id": new_id("sc"), "run_id": rid, "generation_id": s.generation_id, "source": "human",
                      "criterion_id": s.criterion_id, "score": s.score, "note": s.note, "created_at": now()})
    return {"ok": True}


@app.get("/api/runs/{rid}/stats")
def run_stats(rid: str):
    run = db.get("runs", rid) or _404("Run")
    st = stats.compute(run, db.generations_for_run(rid), db.scores_for_run(rid))
    if run["revealed"]:
        models = {s["slot"]: s["model"] for s in run["slots"]}
        for row in st["slots"]:
            m = models[row["slot"]]
            row.update(label=m["label"], provider=m["provider"], model=m["model"])
    if run["blind_mode"] == "per_case" and not run["revealed"]:
        # Per-case labels mean slot letters in disagreements could be cross-referenced; keep them coarse.
        for d in st["disagreements"]:
            d["slot"] = None
    return st


@app.get("/api/runs/{rid}/export")
def export_run(rid: str):
    run = db.get("runs", rid) or _404("Run")
    return {"run": public_run(run), "generations": db.generations_for_run(rid), "scores": db.scores_for_run(rid),
            "stats": run_stats(rid)}


# ---------------- static frontend (production build) ----------------

DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"))
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
