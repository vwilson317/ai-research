"""Personal library: transcript parsing, voice-note import, context injection, podcast import."""
import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db, library, podcasts, prompting, providers


@pytest.fixture()
def client(tmp_path):
    db.reset_for_tests(tmp_path / "test.db")
    from app.main import app
    with TestClient(app) as c:
        yield c


# ---------- parsing ----------

def test_parse_vtt_with_voice_tags():
    raw = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Maya>Hello there.\n\n00:00:03.000 --> 00:00:05.000\n<v Maya>Still me.\n\n00:00:05.000 --> 00:00:07.000\n<v Dev>Hi Maya."
    segs = library.parse_transcript(raw, "text/vtt")
    assert [s["speaker"] for s in segs] == ["Maya", "Dev"]
    assert segs[0]["text"] == "Hello there. Still me."


def test_parse_podcast_namespace_json():
    raw = json.dumps({"version": "1.0.0", "segments": [
        {"speaker": "Host", "startTime": 0, "body": "Welcome"}, {"speaker": "Host", "startTime": 1, "body": "back."},
        {"speaker": "Guest", "startTime": 2, "body": "Thanks!"}]})
    segs = library.parse_transcript(raw, "application/json")
    assert segs == [{"speaker": "Host", "text": "Welcome back.", "start": 0}, {"speaker": "Guest", "text": "Thanks!", "start": 2}]


def test_parse_srt_and_html_and_plain():
    srt = "1\n00:00:01,000 --> 00:00:02,000\nAlex: First line\n\n2\n00:00:02,000 --> 00:00:03,000\nSam: Second"
    assert [s["speaker"] for s in library.parse_transcript(srt, name="x.srt")] == ["Alex", "Sam"]
    html = "<html><body><p><cite>Alex:</cite></p><p>Alex: Hi &amp; welcome</p><p>Sam: Thanks</p><script>x()</script></body></html>"
    segs = library.parse_transcript(html, "text/html")
    assert segs[-1] == {"speaker": "Sam", "text": "Thanks", "start": None}
    assert library.parse_speaker_lines("just a monologue\nwith two lines")[0]["speaker"] is None


# ---------- voice note folder import ----------

def test_import_folder(client, tmp_path):
    folder = tmp_path / "Transcripts" / "sub"
    folder.mkdir(parents=True)
    (folder / "Morning walk_transcript.txt").write_text("so I was thinking about the move again")
    (folder / "Morning walk_transcript.json").write_text(json.dumps({"text": "duplicate of the txt"}))
    (folder / "Idea_transcript.json").write_text(json.dumps({"text": " app idea dump ", "segments": []}))
    (folder / "empty.txt").write_text("   ")
    r = client.post("/api/library/import-folder", json={"path": str(tmp_path / "Transcripts")}).json()
    assert r["added"] == 2, r
    again = client.post("/api/library/import-folder", json={"path": str(tmp_path / "Transcripts")}).json()
    assert again["added"] == 0
    notes = client.get("/api/library?kind=voice_note").json()
    assert {n["title"] for n in notes} == {"Morning walk", "Idea"}
    assert client.get("/api/settings").json()["voice_folder"] == str(tmp_path / "Transcripts")
    assert client.post("/api/library/import-folder", json={"path": str(tmp_path / "nope")}).status_code == 400


# ---------- context in prompts ----------

def test_context_injection_and_exclusion():
    run = {
        "suite": {"system_prompt": "Be an editor.", "context": {"doc_ids": ["a", "b"], "role": "voice", "max_chars": 1000}},
        "docs": {"a": {"id": "a", "kind": "voice_note", "title": "Note A", "text": "yo whats good", "created_at": "2026-02-01"},
                 "b": {"id": "b", "kind": "voice_note", "title": "Note B", "text": "the case itself", "created_at": "2026-03-01"},
                 "p": {"id": "p", "kind": "podcast", "title": "Ep", "text": "Host: hi", "created_at": None}},
    }
    case = {"input": "fix this", "source_doc_id": "b", "context_doc_ids": ["p"]}
    sys = prompting.system_prompt(run, case, {"system_prompt": "Model extra."})
    assert "Be an editor." in sys and "yo whats good" in sys and "the case itself" not in sys and sys.endswith("Model extra.")
    user = prompting.user_prompt(run, case)
    assert user.startswith('<transcript title="Ep">') and user.endswith("fix this")
    run["suite"]["context"]["max_chars"] = 5
    assert "the c</sample>" in prompting.context_block(run, {"input": ""}).replace("\n", "")  # newest first, truncated


def test_templates_seeded_and_runnable(client):
    suites = {s["id"]: s for s in client.get("/api/suites").json()}
    assert {"s_voice_rewrite", "s_reflection_advice", "s_podcast_summary"} <= set(suites)
    doc = client.get("/api/library/doc_sample_podcast").json()
    assert {s["speaker"] for s in doc["segments"]} == {"Maya", "Dev"}

    # voice profile: add a voice note and attach it to the rewrite suite
    note = client.post("/api/library", json={"kind": "voice_note", "title": "me", "text": "honestly lowkey love this"}).json()
    s = suites["s_voice_rewrite"]
    s["context"]["doc_ids"] = [note["id"]]
    assert client.put(f"/api/suites/{s['id']}", json=s).status_code == 200

    mocks = [m["id"] for m in client.get("/api/models").json() if m["provider"] == "mock"][:2]
    for sid in ("s_voice_rewrite", "s_podcast_summary", "s_reflection_advice"):
        run = client.post("/api/runs", json={"suite_id": sid, "model_ids": mocks,
                                             "judge": {"enabled": True, "model": "mock-judge"}}).json()
        deadline = time.time() + 20
        while time.time() < deadline:
            r = client.get(f"/api/runs/{run['id']}").json()
            if r["status"] == "ready" and not r["busy"]:
                break
            time.sleep(0.1)
        assert r["judge_status"] == "done", (sid, r["judge_errors"])
        assert "docs" not in r
        if sid == "s_podcast_summary":
            assert r["doc_titles"]["doc_sample_podcast"]["kind"] == "podcast"
            assert "Maya" in client.get(f"/api/runs/{run['id']}/docs/doc_sample_podcast").json()["text"]
        if sid == "s_voice_rewrite":
            assert note["id"] in r["doc_titles"]
            gens = client.get(f"/api/runs/{run['id']}/review").json()["units"][0]["items"]
            assert any("input length" in c["check"] for c in gens[0]["checks"])


# ---------- podcasts (mocked network) ----------

FEED = """<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
<title>Test Pod</title><itunes:author>Tester</itunes:author>
<item><title>Ep 2</title><guid>g2</guid><enclosure url="https://cdn.test/ep2.mp3" type="audio/mpeg"/></item>
<item><title>Ep 1</title><guid>g1</guid><enclosure url="https://cdn.test/ep1.mp3" type="audio/mpeg"/>
<description>&lt;p&gt;About &lt;b&gt;habits&lt;/b&gt;&lt;/p&gt;</description>
<podcast:transcript url="https://cdn.test/ep1.html" type="text/html"/>
<podcast:transcript url="https://cdn.test/ep1.json" type="application/json"/></item>
</channel></rss>"""


@pytest.fixture()
def fake_net(monkeypatch):
    calls = []

    def handler(req: httpx.Request):
        url = str(req.url)
        calls.append((req.method, url))
        if url.startswith("https://feed.test"):
            return httpx.Response(200, text=FEED)
        if url == "https://cdn.test/ep1.json":
            return httpx.Response(200, json={"segments": [{"speaker": "Ann", "body": "Habits win."}, {"speaker": "Bo", "body": "Goals matter."}]})
        if url == "https://cdn.test/ep2.mp3":
            return httpx.Response(200, content=b"ID3fakeaudio", headers={"content-type": "audio/mpeg"})
        if "upload/v1beta/files" in url:
            return httpx.Response(200, headers={"x-goog-upload-url": "https://upload.test/session"})
        if url == "https://upload.test/session":
            return httpx.Response(200, json={"file": {"name": "files/abc", "uri": "https://g/files/abc", "mimeType": "audio/mpeg", "state": "ACTIVE"}})
        if url.endswith(":generateContent"):
            body = json.loads(req.content)
            assert body["contents"][0]["parts"][0]["fileData"]["fileUri"] == "https://g/files/abc"
            return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [
                {"text": "Host: Welcome to episode two.\n\nGuest: Glad to be here."}]}}]})
        if req.method == "DELETE":
            return httpx.Response(200, json={})
        return httpx.Response(404)

    real = httpx.AsyncClient
    monkeypatch.setattr(podcasts.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return calls


def test_episodes_and_feed_transcript(client, fake_net):
    eps = asyncio.run(podcasts.episodes("https://feed.test/rss"))
    assert eps["podcast"] == "Test Pod" and [e["guid"] for e in eps["episodes"]] == ["g2", "g1"]
    assert eps["episodes"][1]["description"] == "About habits"
    doc = library.make_doc("podcast", "x", status="processing")
    library.save(doc)
    asyncio.run(podcasts.import_episode(doc["id"], "https://feed.test/rss", "g1", "auto"))
    d = db.get("library", doc["id"])
    assert d["status"] == "ready", d["error"]
    assert d["meta"]["transcript_url"].endswith(".json")  # json preferred over html
    assert [s["speaker"] for s in d["segments"]] == ["Ann", "Bo"] and d["title"] == "Test Pod — Ep 1"


def test_gemini_transcription_fallback(client, fake_net, monkeypatch):
    monkeypatch.setattr(providers, "key_for", lambda *a, **k: "k")
    doc = library.make_doc("podcast", "x", status="processing")
    library.save(doc)
    asyncio.run(podcasts.import_episode(doc["id"], "https://feed.test/rss", "g2", "auto"))
    d = db.get("library", doc["id"])
    assert d["status"] == "ready", d["error"]
    assert d["meta"]["transcript_source"] == "gemini" and not d["meta"]["truncated"]
    assert [s["speaker"] for s in d["segments"]] == ["Host", "Guest"]
    assert ("DELETE", "https://generativelanguage.googleapis.com/v1beta/files/abc") in fake_net

    # 'feed' mode refuses to transcribe
    doc2 = library.make_doc("podcast", "x", status="processing")
    library.save(doc2)
    asyncio.run(podcasts.import_episode(doc2["id"], "https://feed.test/rss", "g2", "feed"))
    assert db.get("library", doc2["id"])["status"] == "error"


def test_rename_speakers(client):
    doc = client.post("/api/library", json={"kind": "podcast", "title": "t", "text": "SPEAKER_00: hi\n\nSPEAKER_01: hey\n\nSPEAKER_00: bye"}).json()
    out = client.post(f"/api/library/{doc['id']}/speakers", json={"SPEAKER_00": "Travis", "SPEAKER_01": "Eric"}).json()
    assert [s["speaker"] for s in out["segments"]] == ["Travis", "Eric", "Travis"]
    assert out["text"].startswith("Travis: hi")
