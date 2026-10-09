"""End-to-end flow using the offline mock provider and mock judge."""
import time

import pytest
from fastapi.testclient import TestClient

from app import db
from app.checks import run_check
from app.schemas import AutoCheck


@pytest.fixture()
def client(tmp_path):
    db.reset_for_tests(tmp_path / "test.db")
    from app.main import app
    with TestClient(app) as c:
        yield c


def wait_for(client, rid, pred, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{rid}").json()
        if pred(run):
            return run
        time.sleep(0.1)
    raise AssertionError(f"timed out; last state {run}")


def test_full_blind_flow(client):
    models = client.get("/api/models").json()
    mock_ids = [m["id"] for m in models if m["provider"] == "mock"]
    assert len(mock_ids) == 3
    suite = client.get("/api/suites").json()[0]

    r = client.post("/api/runs", json={
        "suite_id": suite["id"], "model_ids": mock_ids, "samples_per_case": 2,
        "judge": {"enabled": True, "model": "mock-judge", "mode": "individual"},
    })
    assert r.status_code == 200, r.text
    run = r.json()
    rid = run["id"]
    # identities hidden
    assert all(set(s) == {"slot"} for s in run["slots"])

    run = wait_for(client, rid, lambda r: r["status"] == "ready" and not r["busy"])
    assert run["judge_status"] == "done", run["judge_errors"]

    review = client.get(f"/api/runs/{rid}/review").json()
    assert len(review["units"]) == len(suite["cases"]) * 2
    item = review["units"][0]["items"][0]
    assert item["ai"] is None and "model_label" not in item

    # human grades every generation
    human_crit = [c for c in suite["criteria"] if c["graded_by"] in ("human", "both")]
    scores = []
    for u in review["units"]:
        for it in u["items"]:
            good = "careful answer" in (it["output"] or "")
            for c in human_crit:
                scores.append({"generation_id": it["generation_id"], "criterion_id": c["id"],
                               "score": c["scale_max"] if good else (0 if c["scale_max"] == 1 else 1)})
    assert client.post(f"/api/runs/{rid}/scores", json={"scores": scores}).status_code == 200

    st = client.get(f"/api/runs/{rid}/stats").json()
    assert st["progress"]["human_done"] == st["progress"]["human_needed"] > 0
    assert st["progress"]["ai_done"] == st["progress"]["ai_needed"]
    assert all("label" not in row for row in st["slots"])
    assert st["agreement"]["overall"]["n"] > 0
    assert all(row["win_rate"] is not None for row in st["slots"])

    # bad score rejected
    bad = client.post(f"/api/runs/{rid}/scores", json={"scores": [{**scores[0], "score": 99}]})
    assert bad.status_code == 400

    # meta review
    assert client.post(f"/api/runs/{rid}/meta-review").status_code == 200
    run = wait_for(client, rid, lambda r: r["meta_status"] in ("done", "error"))
    assert run["meta_status"] == "done" and run["meta_review"]["summary"]

    # reveal
    run = client.post(f"/api/runs/{rid}/reveal").json()
    assert all("label" in s for s in run["slots"])
    st = client.get(f"/api/runs/{rid}/stats").json()
    best = max(st["slots"], key=lambda r: r["human_score"])
    assert best["model"] == "mock-strong"


def test_comparative_judge_and_per_case_blinding(client):
    mock_ids = [m["id"] for m in client.get("/api/models").json() if m["provider"] == "mock"][:2]
    suite = client.get("/api/suites").json()[0]
    rid = client.post("/api/runs", json={
        "suite_id": suite["id"], "model_ids": mock_ids, "blind_mode": "per_case",
        "judge": {"enabled": True, "model": "mock-judge", "mode": "comparative"},
    }).json()["id"]
    wait_for(client, rid, lambda r: r["status"] == "ready" and not r["busy"])
    st = client.get(f"/api/runs/{rid}/stats").json()
    assert st["progress"]["ai_done"] == st["progress"]["ai_needed"] > 0
    item = client.get(f"/api/runs/{rid}/review").json()["units"][0]["items"][0]
    assert item["slot"] is None and item["display_label"].startswith("Response")


def test_missing_key_is_recorded_as_error(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    models = client.get("/api/models").json()
    claude = next(m for m in models if m["provider"] == "anthropic")
    mock = next(m for m in models if m["provider"] == "mock")
    suite = client.get("/api/suites").json()[0]
    rid = client.post("/api/runs", json={"suite_id": suite["id"], "model_ids": [claude["id"], mock["id"]],
                                         "judge": {"enabled": False}}).json()["id"]
    wait_for(client, rid, lambda r: r["status"] == "ready" and not r["busy"])
    st = client.get(f"/api/runs/{rid}/stats").json()
    assert sorted(r["errors"] for r in st["slots"]) == [0, len(suite["cases"])]


@pytest.mark.parametrize("check,out,ok", [
    (AutoCheck(type="contains", value="foo"), "a FOO b", True),
    (AutoCheck(type="contains", value="foo", case_sensitive=True), "a FOO b", False),
    (AutoCheck(type="json_valid"), "```json\n[1,2]\n```", True),
    (AutoCheck(type="json_valid"), "{nope", False),
    (AutoCheck(type="max_words", value="3"), "one two three four", False),
    (AutoCheck(type="regex", value=r"\d{3}"), "abc 123", True),
])
def test_checks(check, out, ok):
    assert run_check(check, out, None)["passed"] is ok
