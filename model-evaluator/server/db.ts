/**
 * Tiny Postgres document store. Production: Netlify DB / Neon over HTTP (NETLIFY_DATABASE_URL or DATABASE_URL).
 * Local dev and tests: PGlite (embedded Postgres) — same SQL, no account needed.
 */
import { neon } from '@neondatabase/serverless';

type Row = Record<string, any>;
export interface Sql { query(text: string, params?: unknown[]): Promise<Row[]> }
export type Doc = Record<string, any> & { id: string };
export type DocTable = 'models' | 'suites' | 'runs' | 'library';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS suites (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS library (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS idx_gen_run ON generations(run_id);
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, generation_id TEXT NOT NULL, source TEXT NOT NULL,
  criterion_id TEXT NOT NULL, data JSONB NOT NULL, UNIQUE (generation_id, source, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_run ON scores(run_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let sqlPromise: Promise<Sql> | null = null;

export function databaseUrl() {
  return process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || '';
}

async function connect(): Promise<Sql> {
  const url = databaseUrl();
  let sql: Sql;
  if (url) {
    const q = neon(url);
    sql = { query: (t, p) => q.query(t, p ?? []) as Promise<Row[]> };
  } else {
    // Non-literal specifier so the Netlify bundler never pulls PGlite into production functions.
    const mod = ['@electric-sql', 'pglite'].join('/');
    const { PGlite } = await import(/* @vite-ignore */ mod);
    const dir = process.env.EVAL_DATA_DIR ?? '.data/pglite';
    if (dir !== 'memory') (await import('node:fs')).mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir === 'memory' ? undefined : dir);
    sql = { query: async (t, p) => (await db.query(t, p ?? [])).rows as Row[] };
    (sql as any).exec = (t: string) => db.exec(t);
  }
  if ((sql as any).exec) await (sql as any).exec(SCHEMA);
  else for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await sql.query(stmt);
  return sql;
}

export function sql(): Promise<Sql> {
  if (!sqlPromise) sqlPromise = connect().catch((e) => { sqlPromise = null; throw e; });
  return sqlPromise;
}

/** Tests: start from a fresh in-memory database. */
export function resetForTests() {
  sqlPromise = null;
}

const j = (v: unknown) => JSON.stringify(v);

// ---------------- documents ----------------

export async function put<T extends Doc>(table: DocTable, doc: T): Promise<T> {
  await (await sql()).query(
    `INSERT INTO ${table}(id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [doc.id, j(doc)]);
  return doc;
}

export async function get<T extends Doc = Doc>(table: DocTable, id: string): Promise<T | null> {
  const rows = await (await sql()).query(`SELECT data FROM ${table} WHERE id = $1`, [id]);
  return (rows[0]?.data as T) ?? null;
}

export async function all<T extends Doc = Doc>(table: DocTable): Promise<T[]> {
  return (await (await sql()).query(`SELECT data FROM ${table}`)).map((r) => r.data as T);
}

/** Merge top-level fields atomically (safe against concurrent workers touching other fields). */
export async function patch<T extends Doc = Doc>(table: DocTable, id: string, fields: Record<string, unknown>): Promise<T> {
  const rows = await (await sql()).query(
    `UPDATE ${table} SET data = data || $2::jsonb WHERE id = $1 RETURNING data`, [id, j(fields)]);
  if (!rows[0]) throw new Error(`${table} ${id} not found`);
  return rows[0].data as T;
}

export async function del(table: DocTable, id: string) {
  const s = await sql();
  await s.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  if (table === 'runs') {
    await s.query('DELETE FROM generations WHERE run_id = $1', [id]);
    await s.query('DELETE FROM scores WHERE run_id = $1', [id]);
  }
}

/** Library listing without the (possibly huge) text bodies. */
export async function librarySummaries(kind?: string) {
  const rows = await (await sql()).query(
    `SELECT data - 'text' - 'segments' AS data, left(data->>'text', 240) AS preview,
            jsonb_typeof(data->'segments') = 'array' AND jsonb_array_length(data->'segments') > 0 AS has_segments,
            (SELECT coalesce(jsonb_agg(DISTINCT s->>'speaker'), '[]'::jsonb) FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(data->'segments') = 'array' THEN data->'segments' ELSE '[]'::jsonb END) s
             WHERE s->>'speaker' IS NOT NULL) AS speakers
     FROM library ${kind ? `WHERE data->>'kind' = $1` : ''}
     ORDER BY data->>'created_at' DESC NULLS LAST`, kind ? [kind] : []);
  return rows.map((r) => ({ ...r.data, preview: r.preview ?? '', has_segments: !!r.has_segments, speakers: r.speakers ?? [] }));
}

// ---------------- generations ----------------

export async function putGeneration(g: Doc & { run_id: string }) {
  await (await sql()).query(
    `INSERT INTO generations(id, run_id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [g.id, g.run_id, j(g)]);
}

export async function putGenerations(gens: (Doc & { run_id: string })[]) {
  const s = await sql();
  for (let i = 0; i < gens.length; i += 200) {
    const chunk = gens.slice(i, i + 200);
    const values = chunk.map((_, k) => `($${k * 3 + 1}, $${k * 3 + 2}, $${k * 3 + 3}::jsonb)`).join(',');
    await s.query(`INSERT INTO generations(id, run_id, data) VALUES ${values} ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      chunk.flatMap((g) => [g.id, g.run_id, j(g)]));
  }
}

export async function generationsForRun(runId: string): Promise<Doc[]> {
  return (await (await sql()).query('SELECT data FROM generations WHERE run_id = $1', [runId])).map((r) => r.data);
}

// ---------------- scores ----------------

export async function putScore(sc: Doc & { run_id: string; generation_id: string; source: string; criterion_id: string }) {
  await (await sql()).query(
    `INSERT INTO scores(id, run_id, generation_id, source, criterion_id, data) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (generation_id, source, criterion_id) DO UPDATE SET data = EXCLUDED.data`,
    [sc.id, sc.run_id, sc.generation_id, sc.source, sc.criterion_id, j(sc)]);
}

export async function deleteScores(runId: string, source: string) {
  await (await sql()).query('DELETE FROM scores WHERE run_id = $1 AND source = $2', [runId, source]);
}

export async function scoresForRun(runId: string): Promise<Doc[]> {
  return (await (await sql()).query('SELECT data FROM scores WHERE run_id = $1', [runId])).map((r) => r.data);
}

// ---------------- settings ----------------

export async function getSetting(key: string): Promise<string | null> {
  const rows = await (await sql()).query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string | null) {
  const s = await sql();
  if (value) await s.query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
  else await s.query('DELETE FROM settings WHERE key = $1', [key]);
}
