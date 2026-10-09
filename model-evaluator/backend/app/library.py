"""Personal context library: voice-note transcripts, podcast transcripts and other documents."""
import html
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import db

DEFAULT_VOICE_FOLDER = "~/Library/Mobile Documents/com~apple~CloudDocs/Transcripts"
TEXT_EXTS = {".txt", ".md", ".json", ".srt", ".vtt"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_doc(kind: str, title: str, text: str = "", **extra) -> dict:
    doc = {
        "id": f"doc_{uuid.uuid4().hex[:10]}", "kind": kind, "title": title.strip() or "Untitled",
        "text": text, "segments": None, "source": None, "status": "ready", "error": None,
        "created_at": now(), "imported_at": now(), "meta": {},
    }
    doc.update(extra)
    doc["word_count"] = len((doc["text"] or "").split())
    return doc


def save(doc: dict) -> dict:
    doc["word_count"] = len((doc.get("text") or "").split())
    return db.put("library", doc)


def summary(doc: dict) -> dict:
    """List view: drop the (possibly huge) body."""
    out = {k: v for k, v in doc.items() if k not in ("text", "segments")}
    out["preview"] = (doc.get("text") or "")[:240]
    out["has_segments"] = bool(doc.get("segments"))
    out["speakers"] = sorted({s["speaker"] for s in doc.get("segments") or [] if s.get("speaker")})
    return out


# ---------------- transcript parsing ----------------

_TS = re.compile(r"^\s*\d{1,2}:\d{2}(:\d{2})?[.,]\d{1,3}\s*-->")
_SPEAKER_LINE = re.compile(r"^\s*([A-Z][\w .'\-]{0,40}?|Speaker \d+|SPEAKER_\d+)\s*:\s+(.+)$")


def merge_segments(segs: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in segs:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        sp = (s.get("speaker") or "").strip() or None
        if out and out[-1]["speaker"] == sp:
            out[-1]["text"] += " " + text
        else:
            out.append({"speaker": sp, "text": text, "start": s.get("start")})
    return out


def segments_to_text(segs: list[dict]) -> str:
    return "\n\n".join(f"{s['speaker']}: {s['text']}" if s.get("speaker") else s["text"] for s in segs)


def parse_speaker_lines(text: str) -> list[dict]:
    segs = []
    for para in re.split(r"\n\s*\n|\n(?=[A-Z][\w .'\-]{0,40}:\s)", text.strip()):
        para = para.strip()
        if not para:
            continue
        m = _SPEAKER_LINE.match(para.replace("\n", " "))
        segs.append({"speaker": m.group(1).strip(), "text": m.group(2)} if m else {"speaker": None, "text": para})
    return merge_segments(segs)


def parse_vtt_srt(raw: str) -> list[dict]:
    segs = []
    for block in re.split(r"\n\s*\n", raw.replace("\r", "")):
        lines = [l for l in block.split("\n") if l.strip()]
        lines = [l for l in lines if not _TS.match(l) and not l.strip().isdigit() and not l.startswith(("WEBVTT", "NOTE", "STYLE"))]
        if not lines:
            continue
        text = " ".join(lines)
        m = re.match(r"^<v(?:\.[^ >]*)?\s+([^>]+)>(.*)$", text)
        if m:
            segs.append({"speaker": m.group(1).strip(), "text": re.sub(r"</?v[^>]*>", "", m.group(2))})
            continue
        m = _SPEAKER_LINE.match(text)
        segs.append({"speaker": m.group(1), "text": m.group(2)} if m else {"speaker": None, "text": text})
    for s in segs:
        s["text"] = re.sub(r"<[^>]+>", "", s["text"])
    return merge_segments(segs)


def parse_json_transcript(raw: str) -> list[dict]:
    data = json.loads(raw)
    if isinstance(data, dict) and isinstance(data.get("segments"), list):  # podcast namespace or whisper json
        segs = merge_segments([{"speaker": s.get("speaker"), "text": s.get("body") or s.get("text") or "",
                                "start": s.get("startTime", s.get("start"))} for s in data["segments"] if isinstance(s, dict)])
        has_speakers = any(s["speaker"] for s in segs)
        if segs and (has_speakers or not isinstance(data.get("text"), str)):
            return segs
    if isinstance(data, dict) and isinstance(data.get("text"), str):
        return [{"speaker": None, "text": data["text"].strip(), "start": None}]
    raise ValueError("Unrecognised JSON transcript format")


def parse_html_transcript(raw: str) -> list[dict]:
    raw = re.sub(r"(?is)<(script|style).*?</\1>", "", raw)
    raw = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</h\d>|</li>", "\n\n", raw)
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    text = re.sub(r"(?m)^\s*\d{1,2}:\d{2}(:\d{2})?\s*$", "", text)  # bare timestamps
    return parse_speaker_lines(text)


def parse_transcript(raw: str, mime: str = "", name: str = "") -> list[dict]:
    mime, name = mime.lower(), name.lower()
    if "json" in mime or name.endswith(".json"):
        return parse_json_transcript(raw)
    if "vtt" in mime or "srt" in mime or "subrip" in mime or name.endswith((".vtt", ".srt")):
        return parse_vtt_srt(raw)
    if "html" in mime or name.endswith((".html", ".htm")) or raw.lstrip().startswith("<"):
        return parse_html_transcript(raw)
    return parse_speaker_lines(raw)


# ---------------- voice notes from a folder ----------------

def _read_voice_file(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")
    ext = path.suffix.lower()
    if ext in (".json", ".srt", ".vtt"):
        try:
            segs = parse_transcript(raw, name=path.name)
            return " ".join(s["text"] for s in segs) if all(not s["speaker"] for s in segs) else segments_to_text(segs)
        except (ValueError, json.JSONDecodeError):
            return raw
    return raw.strip()


def import_folder(path: str) -> dict:
    folder = Path(os.path.expanduser(path))
    if not folder.is_dir():
        raise ValueError(f"Folder not found: {folder}. If running in Docker, mount it (see README).")
    existing = {d.get("source"): d for d in db.all_docs("library") if d.get("kind") == "voice_note"}
    added = updated = skipped = 0
    for f in sorted(folder.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in TEXT_EXTS or f.name.startswith("."):
            continue
        # prefer one format per recording when the transcriber wrote several
        stem = re.sub(r"_transcript$", "", f.stem)
        text = _read_voice_file(f)
        if not text.strip():
            skipped += 1
            continue
        mtime = datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat()
        src = str(f)
        if src in existing:
            doc = existing[src]
            if doc.get("text") != text:
                doc.update(text=text, created_at=mtime)
                save(doc)
                updated += 1
            else:
                skipped += 1
            continue
        siblings = [d for d in existing.values() if d.get("meta", {}).get("stem") == f"{f.parent}/{stem}"]
        if siblings:
            skipped += 1
            continue
        doc = make_doc("voice_note", stem.replace("_", " "), text, source=src, created_at=mtime,
                       meta={"stem": f"{f.parent}/{stem}"})
        save(doc)
        existing[src] = doc
        added += 1
    db.set_setting("VOICE_FOLDER", path)
    return {"added": added, "updated": updated, "skipped": skipped, "folder": str(folder)}


# ---------------- resolving docs for prompts ----------------

def resolve(doc_ids: list[str]) -> dict[str, dict]:
    out = {}
    for i in doc_ids:
        d = db.get("library", i)
        if d and d.get("status") == "ready":
            out[i] = {"id": i, "kind": d["kind"], "title": d["title"], "text": d.get("text") or "",
                      "created_at": d.get("created_at"), "segments": d.get("segments")}
    return out
