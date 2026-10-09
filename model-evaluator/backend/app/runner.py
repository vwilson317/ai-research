"""Run orchestration: generate outputs, run auto-checks, run the AI judge, run the meta-review."""
import asyncio
import random
import string
import time
import uuid
from datetime import datetime, timezone

from . import db, judge, library, prompting, providers, stats
from .checks import run_checks
from .providers import ProviderError
from .schemas import AutoCheck, RunCreate

_tasks: set[asyncio.Task] = set()
_active: dict[str, asyncio.Task] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def update_run(run_id: str, **fields) -> dict:
    with db._lock:
        run = db.get("runs", run_id)
        run.update(fields)
        db.put("runs", run)
    return run


def spawn(run_id: str, coro) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    _active[run_id] = task
    task.add_done_callback(_tasks.discard)


def is_busy(run_id: str) -> bool:
    t = _active.get(run_id)
    return t is not None and not t.done()


def create_run(req: RunCreate) -> dict:
    suite = db.get("suites", req.suite_id)
    if not suite:
        raise ValueError("Suite not found")
    if not suite["cases"]:
        raise ValueError("Suite has no test cases")
    models = []
    for mid in req.model_ids:
        m = db.get("models", mid)
        if not m:
            raise ValueError(f"Model {mid} not found")
        models.append(m)
    # Blind assignment: shuffle which model gets which anonymous letter.
    shuffled = models[:]
    random.SystemRandom().shuffle(shuffled)
    letters = string.ascii_uppercase
    slots = [{"slot": letters[i], "model": m} for i, m in enumerate(shuffled)]
    doc_ids = list((suite.get("context") or {}).get("doc_ids", []))
    for c in suite["cases"]:
        doc_ids += c.get("context_doc_ids") or []
    docs = library.resolve(list(dict.fromkeys(doc_ids)))
    run = {
        "id": new_id("run"),
        "name": req.name or f"{suite['name']} · {datetime.now().strftime('%b %d %H:%M')}",
        "created_at": now(),
        "suite": suite,
        "docs": docs,
        "slots": slots,
        "samples_per_case": req.samples_per_case,
        "concurrency": req.concurrency,
        "blind_mode": req.blind_mode,
        "judge": req.judge.model_dump(),
        "seed": random.SystemRandom().randint(0, 2**31),
        "status": "queued",
        "revealed": False,
        "judge_status": "idle",
        "judge_errors": [],
        "meta_review": None,
        "meta_status": "idle",
    }
    db.put("runs", run)
    for case in suite["cases"]:
        for sample in range(req.samples_per_case):
            for s in slots:
                db.put_generation({
                    "id": new_id("gen"), "run_id": run["id"], "case_id": case["id"], "sample": sample,
                    "slot": s["slot"], "status": "pending", "output": None, "error": None,
                })
    spawn(run["id"], execute_run(run["id"]))
    return run


async def execute_run(run_id: str, retry_errors: bool = False) -> None:
    run = update_run(run_id, status="generating", started_at=now())
    suite = run["suite"]
    cases = {c["id"]: c for c in suite["cases"]}
    slot_models = {s["slot"]: s["model"] for s in run["slots"]}
    global_checks = [AutoCheck(**c) for c in suite.get("global_checks", [])]
    sem = asyncio.Semaphore(run["concurrency"])
    gens = [g for g in db.generations_for_run(run_id)
            if g["status"] == "pending" or (retry_errors and g["status"] == "error")]

    async def one(gen: dict):
        async with sem:
            m = slot_models[gen["slot"]]
            case = cases[gen["case_id"]]
            system = prompting.system_prompt(run, case, m)
            t0 = time.perf_counter()
            try:
                comp = await providers.complete(
                    provider=m["provider"], model=m["model"], prompt=prompting.user_prompt(run, case), system=system,
                    temperature=m.get("temperature"), max_tokens=m.get("max_tokens", 2048), top_p=m.get("top_p"),
                    base_url=m.get("base_url"), api_key=providers.key_for(m["provider"], m.get("api_key_env")),
                )
                checks = [AutoCheck(**c) for c in case.get("checks", [])] + global_checks
                gen.update(
                    status="done", error=None, output=comp.text,
                    latency_ms=round((time.perf_counter() - t0) * 1000),
                    input_tokens=comp.input_tokens, output_tokens=comp.output_tokens,
                    cost_usd=(comp.input_tokens * m.get("price_input_per_mtok", 0)
                              + comp.output_tokens * m.get("price_output_per_mtok", 0)) / 1e6,
                    checks=run_checks(checks, comp.text, case.get("reference"), case["input"]),
                )
            except Exception as e:  # noqa: BLE001 - record any provider failure on the generation
                gen.update(status="error", error=str(e)[:1000], latency_ms=round((time.perf_counter() - t0) * 1000))
            db.put_generation(gen)

    await asyncio.gather(*(one(g) for g in gens))
    gens = db.generations_for_run(run_id)
    errors = sum(1 for g in gens if g["status"] == "error")
    update_run(run_id, status="generated", finished_at=now(), error_count=errors)
    run = db.get("runs", run_id)
    if run["judge"]["enabled"] and run["judge"].get("auto_run", True):
        await run_judge(run_id)
    update_run(run_id, status="ready")


async def run_judge(run_id: str) -> None:
    run = update_run(run_id, judge_status="running", judge_errors=[], judge_started_at=now())
    cfg = run["judge"]
    suite = run["suite"]
    cases = {c["id"]: c for c in suite["cases"]}
    ai_criteria = [c for c in suite["criteria"] if c.get("graded_by", "both") in ("ai", "both")]
    if not ai_criteria:
        update_run(run_id, judge_status="skipped")
        return
    db.delete_scores(run_id, "ai")
    gens = [g for g in db.generations_for_run(run_id) if g["status"] == "done"]
    sem = asyncio.Semaphore(max(1, min(run["concurrency"], 8)))
    errors: list[str] = []
    tokens = {"in": 0, "out": 0}

    def save(gen: dict, items: list[dict]):
        by_id = {it.get("criterion_id"): it for it in items}
        for c in ai_criteria:
            it = by_id.get(c["id"])
            if it is None:
                errors.append(f"{gen['case_id']}/{gen['slot']}: judge omitted criterion {c['id']}")
                continue
            db.put_score({
                "id": new_id("sc"), "run_id": run_id, "generation_id": gen["id"], "source": "ai",
                "criterion_id": c["id"], "score": judge.clamp(it.get("score"), c["scale_max"]),
                "rationale": str(it.get("rationale", ""))[:2000], "created_at": now(),
            })

    async def individual(gen: dict):
        async with sem:
            prompt = judge.build_individual_prompt(run, cases[gen["case_id"]], ai_criteria, gen["output"] or "",
                                                   cfg.get("include_reference", True))
            try:
                data, comp = await judge.call_judge(cfg, prompt)
                tokens["in"] += comp.input_tokens; tokens["out"] += comp.output_tokens
                save(gen, data.get("scores", []))
            except Exception as e:  # noqa: BLE001
                errors.append(f"{gen['case_id']}/{gen['slot']}: {str(e)[:300]}")

    async def comparative(unit: list[dict]):
        async with sem:
            order = unit[:]
            random.Random(f"{run['seed']}-judge-{unit[0]['case_id']}-{unit[0]['sample']}").shuffle(order)
            labelled = {f"Response {i + 1}": g for i, g in enumerate(order)}
            prompt = judge.build_comparative_prompt(
                run, cases[unit[0]["case_id"]], ai_criteria,
                [(lab, g["output"] or "") for lab, g in labelled.items()], cfg.get("include_reference", True))
            try:
                data, comp = await judge.call_judge(cfg, prompt)
                tokens["in"] += comp.input_tokens; tokens["out"] += comp.output_tokens
                for ev in data.get("evaluations", []):
                    g = labelled.get(ev.get("label"))
                    if g:
                        save(g, ev.get("scores", []))
            except Exception as e:  # noqa: BLE001
                errors.append(f"{unit[0]['case_id']}: {str(e)[:300]}")

    if cfg.get("mode") == "comparative":
        units: dict[tuple, list] = {}
        for g in gens:
            units.setdefault((g["case_id"], g["sample"]), []).append(g)
        await asyncio.gather(*(comparative(u) for u in units.values()))
    else:
        await asyncio.gather(*(individual(g) for g in gens))
    update_run(run_id, judge_status="done" if not errors else "done_with_errors", judge_errors=errors[:50],
               judge_finished_at=now(), judge_tokens=tokens)


async def run_meta_review(run_id: str) -> None:
    run = update_run(run_id, meta_status="running", meta_error=None)
    gens = db.generations_for_run(run_id)
    st = stats.compute(run, gens, db.scores_for_run(run_id))
    gen_by_id = {g["id"]: g for g in gens}
    cases = {c["id"]: c for c in run["suite"]["cases"]}
    disagreements = []
    for d in st["disagreements"][:10]:
        g = gen_by_id[d["generation_id"]]
        ai = next((s for s in db.scores_for_run(run_id) if s["generation_id"] == g["id"]
                   and s["source"] == "ai" and s["criterion_id"] == d["criterion_id"]), None)
        disagreements.append({**{k: d[k] for k in ("case_id", "slot", "criterion_id", "human", "ai")},
                              "task": cases[g["case_id"]]["input"][:600], "output": (g.get("output") or "")[:1500],
                              "ai_rationale": ai and ai.get("rationale")})
    examples = []
    for case in run["suite"]["cases"][:4]:
        for g in gens:
            if g["case_id"] == case["id"] and g["sample"] == 0 and g["status"] == "done":
                examples.append({"case_id": case["id"], "slot": g["slot"], "output": (g["output"] or "")[:800]})
    lean_stats = {"leaderboard": [{k: v for k, v in r.items()} for r in st["slots"]], "cases": st["cases"],
                  "agreement": st["agreement"], "bias": st["bias"], "progress": st["progress"]}
    try:
        data, _ = await judge.call_judge(run["judge"], judge.build_meta_prompt(run["suite"], lean_stats, disagreements, examples),
                                         system=judge.META_SYSTEM)
        update_run(run_id, meta_status="done", meta_review={**data, "created_at": now(), "model": run["judge"]["model"]})
    except (ProviderError, Exception) as e:  # noqa: BLE001
        update_run(run_id, meta_status="error", meta_error=str(e)[:1000])
