"""Find a podcast by name, list episodes, and get a transcript: from the feed if published, else transcribe with Gemini."""
import asyncio
import mimetypes
import os
import tempfile
import xml.etree.ElementTree as ET

import httpx

from . import db, library, providers
from .providers import ProviderError

UA = {"User-Agent": "model-evaluator/0.1 (personal use)"}
NS = {
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "podcast": "https://podcastindex.org/namespace/1.0",
    "content": "http://purl.org/rss/1.0/modules/content/",
}
MAX_FEED_BYTES = 60 * 1024 * 1024
MAX_AUDIO_BYTES = 1024 * 1024 * 1024
GEMINI = "https://generativelanguage.googleapis.com"
# Preferred transcript formats, best first (speaker labels survive best in JSON / VTT).
FORMAT_RANK = ["application/json", "text/vtt", "application/x-subrip", "application/srt", "text/srt", "text/html", "text/plain"]


async def search(term: str, limit: int = 10) -> list[dict]:
    async with httpx.AsyncClient(timeout=20, headers=UA) as c:
        for attempt in range(4):  # Apple throttles with sporadic 403/429s
            r = await c.get("https://itunes.apple.com/search",
                            params={"term": term, "media": "podcast", "entity": "podcast", "limit": limit})
            if r.status_code not in (403, 429, 503) or attempt == 3:
                break
            await asyncio.sleep(1.5 * (attempt + 1))
        r.raise_for_status()
    return [{"name": x.get("collectionName"), "author": x.get("artistName"), "feed_url": x.get("feedUrl"),
             "artwork": x.get("artworkUrl100"), "episodes": x.get("trackCount"), "genre": x.get("primaryGenreName")}
            for x in r.json().get("results", []) if x.get("feedUrl")]


async def _fetch_feed(feed_url: str) -> ET.Element:
    async with httpx.AsyncClient(timeout=60, headers=UA, follow_redirects=True) as c:
        async with c.stream("GET", feed_url) as r:
            r.raise_for_status()
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf += chunk
                if len(buf) > MAX_FEED_BYTES:
                    raise ProviderError("Feed too large")
    return ET.fromstring(bytes(buf))


def _episode(item: ET.Element) -> dict:
    enc = item.find("enclosure")
    transcripts = [{"url": t.get("url"), "type": (t.get("type") or "").lower()}
                   for t in item.findall("podcast:transcript", NS) if t.get("url")]
    desc = item.findtext("itunes:summary", default="", namespaces=NS) or item.findtext("description", default="")
    return {
        "guid": (item.findtext("guid") or (enc.get("url") if enc is not None else "") or item.findtext("title") or "").strip(),
        "title": (item.findtext("title") or "").strip(),
        "published": item.findtext("pubDate"),
        "duration": item.findtext("itunes:duration", namespaces=NS),
        "audio_url": enc.get("url") if enc is not None else None,
        "audio_type": enc.get("type") if enc is not None else None,
        "description": " ".join(s["text"] for s in library.parse_html_transcript(desc))[:400] if desc.strip() else "",
        "transcripts": transcripts,
    }


async def episodes(feed_url: str, limit: int = 100) -> dict:
    root = await _fetch_feed(feed_url)
    ch = root.find("channel")
    if ch is None:
        raise ProviderError("Not an RSS podcast feed")
    items = [_episode(i) for i in ch.findall("item")[:limit]]
    return {"podcast": (ch.findtext("title") or "").strip(), "author": ch.findtext("itunes:author", namespaces=NS),
            "episodes": items}


async def _fetch_feed_transcript(ep: dict) -> tuple[list[dict], str]:
    ranked = sorted(ep["transcripts"], key=lambda t: next((i for i, f in enumerate(FORMAT_RANK) if f in t["type"]), 99))
    last_err = None
    async with httpx.AsyncClient(timeout=60, headers=UA, follow_redirects=True) as c:
        for t in ranked:
            try:
                r = await c.get(t["url"])
                r.raise_for_status()
                segs = library.parse_transcript(r.text, t["type"] or r.headers.get("content-type", ""), t["url"])
                if segs:
                    return segs, t["url"]
            except Exception as e:  # noqa: BLE001 - try the next format
                last_err = e
    raise ProviderError(f"Feed transcript unusable: {last_err}")


TRANSCRIBE_PROMPT = """Transcribe this podcast episode as a dialogue.
- Identify speakers by their real names when the episode makes them clear (host intros, "thanks for having me, X"); otherwise use "Host", "Guest", "Speaker 3".
- One speaker turn per paragraph, formatted exactly as `Name: what they said`, separated by blank lines.
- Keep the words faithful; drop filler ("um", "uh") and false starts; do not summarise or skip sections, including ads.
- Output only the transcript."""


async def transcribe_with_gemini(audio_url: str, model: str, title: str) -> tuple[list[dict], dict]:
    key = providers.key_for("google")
    if not key:
        raise ProviderError("GEMINI_API_KEY is required to transcribe episodes that have no published transcript")
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
        path = tmp.name
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=20), headers=UA, follow_redirects=True) as c:
            async with c.stream("GET", audio_url) as r:
                r.raise_for_status()
                mime = (r.headers.get("content-type") or "").split(";")[0] or mimetypes.guess_type(audio_url.split("?")[0])[0] or "audio/mpeg"
                if not mime.startswith(("audio/", "video/")):
                    mime = "audio/mpeg"
                size = 0
                with open(path, "wb") as f:
                    async for chunk in r.aiter_bytes(1 << 20):
                        size += len(chunk)
                        if size > MAX_AUDIO_BYTES:
                            raise ProviderError("Audio file over 1 GB")
                        f.write(chunk)

            # Gemini Files API: resumable upload, then wait until the file is ACTIVE.
            start = await c.post(f"{GEMINI}/upload/v1beta/files", headers={
                "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(size), "X-Goog-Upload-Header-Content-Type": mime,
            }, json={"file": {"display_name": title[:100]}})
            if start.status_code >= 400:
                raise ProviderError(f"Gemini upload start failed: {start.text[:300]}")
            upload_url = start.headers.get("x-goog-upload-url")
            with open(path, "rb") as f:
                up = await c.post(upload_url, headers={"X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize",
                                                       "Content-Length": str(size)}, content=f.read())
            if up.status_code >= 400:
                raise ProviderError(f"Gemini upload failed: {up.text[:300]}")
            gfile = up.json()["file"]
            for _ in range(120):
                if gfile.get("state") == "ACTIVE":
                    break
                if gfile.get("state") == "FAILED":
                    raise ProviderError("Gemini could not process the audio file")
                await asyncio.sleep(5)
                gfile = (await c.get(f"{GEMINI}/v1beta/{gfile['name']}", headers={"x-goog-api-key": key})).json()
            try:
                body = {"contents": [{"role": "user", "parts": [
                            {"fileData": {"mimeType": gfile.get("mimeType", mime), "fileUri": gfile["uri"]}},
                            {"text": TRANSCRIBE_PROMPT}]}],
                        "generationConfig": {"temperature": 0, "maxOutputTokens": 65536}}
                r = await c.post(f"{GEMINI}/v1beta/models/{model}:generateContent", json=body, headers={"x-goog-api-key": key})
                if r.status_code >= 400:
                    raise ProviderError(f"Gemini transcription failed: HTTP {r.status_code} {r.text[:300]}")
                data = r.json()
            finally:
                await c.delete(f"{GEMINI}/v1beta/{gfile['name']}", headers={"x-goog-api-key": key})
        cand = (data.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) if not p.get("thought"))
        if not text.strip():
            raise ProviderError(f"Gemini returned an empty transcript ({cand.get('finishReason')})")
        meta = {"transcribed_by": model, "truncated": cand.get("finishReason") == "MAX_TOKENS",
                "usage": data.get("usageMetadata")}
        return library.parse_speaker_lines(text), meta
    finally:
        os.unlink(path)


async def import_episode(doc_id: str, feed_url: str, guid: str, mode: str) -> None:
    """Background job: fill in the placeholder library doc with the episode transcript."""
    doc = db.get("library", doc_id)
    try:
        feed = await episodes(feed_url, limit=100000)
        ep = next((e for e in feed["episodes"] if e["guid"] == guid), None)
        if not ep:
            raise ProviderError("Episode not found in feed")
        doc.update(title=f"{feed['podcast']} — {ep['title']}", source=ep.get("audio_url"),
                   meta={**doc.get("meta", {}), "podcast": feed["podcast"], "episode": ep["title"],
                         "published": ep["published"], "duration": ep["duration"], "feed_url": feed_url})
        segs, how = None, None
        if mode in ("auto", "feed") and ep["transcripts"]:
            try:
                segs, url = await _fetch_feed_transcript(ep)
                how = {"transcript_source": "feed", "transcript_url": url}
            except ProviderError:
                if mode == "feed":
                    raise
        if segs is None:
            if mode == "feed":
                raise ProviderError("This episode has no published transcript; use 'transcribe' mode")
            if not ep.get("audio_url"):
                raise ProviderError("Episode has no audio enclosure")
            doc.update(status="processing", meta={**doc["meta"], "step": "transcribing audio with Gemini"})
            library.save(doc)
            model = db.get_setting("TRANSCRIBE_MODEL") or "gemini-3.8-flash"
            segs, how = await transcribe_with_gemini(ep["audio_url"], model, doc["title"])
            how["transcript_source"] = "gemini"
        doc.update(segments=segs, text=library.segments_to_text(segs), status="ready", error=None,
                   meta={**doc["meta"], **how, "step": None})
    except Exception as e:  # noqa: BLE001
        doc.update(status="error", error=str(e)[:800])
    library.save(doc)
