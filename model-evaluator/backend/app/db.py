"""Tiny SQLite document store. Each row holds a JSON blob plus a few indexed columns."""
import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

DB_PATH = Path(os.environ.get("EVAL_DB_PATH", Path(__file__).resolve().parent.parent / "data" / "evaluator.db"))

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS suites (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_gen_run ON generations(run_id);
CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, generation_id TEXT NOT NULL,
    source TEXT NOT NULL, criterion_id TEXT NOT NULL, data TEXT NOT NULL,
    UNIQUE(generation_id, source, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_run ON scores(run_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

DOC_TABLES = {"models", "suites", "runs"}


def conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.executescript(SCHEMA)
        return _conn


def reset_for_tests(path: Path) -> None:
    global _conn, DB_PATH
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        DB_PATH = path


# ---- documents (models / suites / runs) ----

def put(table: str, doc: dict[str, Any]) -> dict[str, Any]:
    assert table in DOC_TABLES
    with _lock:
        c = conn()
        c.execute(f"INSERT OR REPLACE INTO {table}(id, data) VALUES (?, ?)", (doc["id"], json.dumps(doc)))
        c.commit()
    return doc


def get(table: str, id_: str) -> dict[str, Any] | None:
    assert table in DOC_TABLES
    with _lock:
        row = conn().execute(f"SELECT data FROM {table} WHERE id = ?", (id_,)).fetchone()
    return json.loads(row[0]) if row else None


def all_docs(table: str) -> list[dict[str, Any]]:
    assert table in DOC_TABLES
    with _lock:
        rows = conn().execute(f"SELECT data FROM {table}").fetchall()
    return [json.loads(r[0]) for r in rows]


def delete(table: str, id_: str) -> None:
    assert table in DOC_TABLES
    with _lock:
        c = conn()
        c.execute(f"DELETE FROM {table} WHERE id = ?", (id_,))
        if table == "runs":
            c.execute("DELETE FROM generations WHERE run_id = ?", (id_,))
            c.execute("DELETE FROM scores WHERE run_id = ?", (id_,))
        c.commit()


# ---- generations ----

def put_generation(gen: dict[str, Any]) -> None:
    with _lock:
        c = conn()
        c.execute(
            "INSERT OR REPLACE INTO generations(id, run_id, data) VALUES (?, ?, ?)",
            (gen["id"], gen["run_id"], json.dumps(gen)),
        )
        c.commit()


def generations_for_run(run_id: str) -> list[dict[str, Any]]:
    with _lock:
        rows = conn().execute("SELECT data FROM generations WHERE run_id = ?", (run_id,)).fetchall()
    return [json.loads(r[0]) for r in rows]


# ---- scores ----

def put_score(score: dict[str, Any]) -> None:
    with _lock:
        c = conn()
        c.execute(
            """INSERT INTO scores(id, run_id, generation_id, source, criterion_id, data)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(generation_id, source, criterion_id) DO UPDATE SET data = excluded.data""",
            (score["id"], score["run_id"], score["generation_id"], score["source"], score["criterion_id"], json.dumps(score)),
        )
        c.commit()


def delete_scores(run_id: str, source: str) -> None:
    with _lock:
        c = conn()
        c.execute("DELETE FROM scores WHERE run_id = ? AND source = ?", (run_id, source))
        c.commit()


def scores_for_run(run_id: str) -> list[dict[str, Any]]:
    with _lock:
        rows = conn().execute("SELECT data FROM scores WHERE run_id = ?", (run_id,)).fetchall()
    return [json.loads(r[0]) for r in rows]


# ---- settings ----

def get_setting(key: str) -> str | None:
    with _lock:
        row = conn().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def set_setting(key: str, value: str | None) -> None:
    with _lock:
        c = conn()
        if value:
            c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (key, value))
        else:
            c.execute("DELETE FROM settings WHERE key = ?", (key,))
        c.commit()
