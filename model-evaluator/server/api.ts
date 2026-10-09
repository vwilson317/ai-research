/** The whole REST API as one fetch-style handler (served by a Netlify Function, or the local dev server). */
import * as auth from './auth.ts';
import * as db from './db.ts';
import * as jobs from './jobs.ts';
import * as library from './library.ts';
import * as podcasts from './podcasts.ts';
import * as providers from './providers.ts';
import * as runner from './runner.ts';
import * as stats from './stats.ts';
import { ensureSeeded } from './seed.ts';
import { HttpError, newId, now, seededRandom, shuffle } from './util.ts';

type Params = Record<string, string>;
type Ctx = { req: Request; url: URL; params: Params; origin: string; body: () => Promise<any> };
type Handler = (c: Ctx) => Promise<unknown> | unknown;

const routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
function route(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, h });
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const notFound = (what: string): never => { throw new HttpError(404, `${what} not found`); };
const JUDGE_MODELS = ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite', 'mock-judge'];

export async function handle(req: Request, opts: { origin?: string } = {}): Promise<Response> {
  const url = new URL(req.url);
  const origin = opts.origin ?? url.origin;
  const path = url.pathname.replace(/^\/api/, '') || '/';
  try {
    // ---- auth (the only routes reachable without a session) ----
    if (path === '/session' && req.method === 'GET') return json({ authed: auth.isAuthed(req), mode: auth.authMode() });
    if (path === '/login' && req.method === 'POST') {
      if (auth.authMode() === 'open') return json({ ok: true });
      const { password } = await req.json().catch(() => ({}));
      if (!auth.checkPassword(String(password ?? ''))) {
        await new Promise((r) => setTimeout(r, 400));
        return json({ detail: 'Wrong password' }, 401);
      }
      return json({ ok: true }, 200, { 'set-cookie': auth.sessionCookie(url.protocol === 'https:') });
    }
    if (path === '/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': auth.clearCookie() });
    if (auth.authMode() === 'misconfigured') return json({ detail: 'Set the APP_PASSWORD environment variable in Netlify (Site configuration → Environment variables) and redeploy.' }, 503);
    if (!auth.isAuthed(req)) return json({ detail: 'Not logged in' }, 401);

    await ensureSeeded();
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let cached: any;
      const body = async () => (cached ??= await req.json().catch(() => { throw new HttpError(400, 'Invalid JSON body'); }));
      const out = await r.h({ req, url, params, origin, body });
      return out instanceof Response ? out : json(out);
    }
    return json({ detail: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ detail: e.message }, e.status);
    console.error(e);
    return json({ detail: `Server error: ${(e as Error).message}` }, 500);
  }
}

// ---------------- settings / keys ----------------

async function settingsView() {
  const keys: Record<string, unknown> = {};
  for (const name of providers.ALL_KEYS) {
    const stored = await db.getSetting(`key:${name}`);
    const val = await providers.resolveKey(name);
    keys[name] = { set: !!val, source: stored && val ? 'settings' : val ? 'env' : null, preview: val ? `…${val.slice(-4)}` : null };
  }
  return { keys, judge_models: JUDGE_MODELS, transcribe_model: (await db.getSetting('TRANSCRIBE_MODEL')) || 'gemini-3.8-flash',
    database: db.databaseUrl() ? 'postgres' : 'local' };
}

route('GET', '/settings', settingsView);
route('PUT', '/settings', async ({ body }) => {
  const { keys = {}, transcribe_model } = await body();
  for (const [k, v] of Object.entries(keys as Record<string, string | null>)) {
    if (!providers.ALL_KEYS.includes(k) && !/^[A-Z][A-Z0-9_]{2,63}$/.test(k)) throw new HttpError(400, `Bad key name ${k}`);
    await db.setSetting(`key:${k}`, v && v.trim() ? auth.encrypt(v.trim()) : null);
  }
  if (transcribe_model !== undefined) await db.setSetting('TRANSCRIBE_MODEL', transcribe_model || null);
  return settingsView();
});

// ---------------- library ----------------

route('GET', '/library', ({ url }) => db.librarySummaries(url.searchParams.get('kind') ?? undefined));
route('GET', '/library/:id', async ({ params }) => (await db.get('library', params.id)) ?? notFound('Document'));

const summary = (d: db.Doc) => ({ ...d, text: undefined, segments: undefined, preview: (d.text ?? '').slice(0, 240),
  has_segments: !!d.segments?.length, speakers: [...new Set((d.segments ?? []).map((s: any) => s.speaker).filter(Boolean))] });

route('POST', '/library', async ({ body }) => {
  const b = await body();
  if (!b.title || typeof b.text !== 'string') throw new HttpError(400, 'title and text are required');
  const kind = ['voice_note', 'podcast', 'document'].includes(b.kind) ? b.kind : 'document';
  const doc = library.makeDoc(kind, b.title, b.text.trim(), { source: b.source ?? null, ...(b.created_at ? { created_at: b.created_at } : {}) });
  if (kind === 'podcast') {
    const segs = library.parseSpeakerLines(b.text);
    if (segs.some((s) => s.speaker)) doc.segments = segs;
  }
  return summary(await library.save(doc));
});

route('PUT', '/library/:id', async ({ params, body }) => {
  const doc = (await db.get('library', params.id)) ?? notFound('Document');
  const b = await body();
  Object.assign(doc, { title: b.title ?? doc.title, text: b.text ?? doc.text });
  if (doc.segments) doc.segments = library.parseSpeakerLines(doc.text);
  return summary(await library.save(doc));
});

route('DELETE', '/library/:id', async ({ params }) => { await db.del('library', params.id); return { ok: true }; });

route('POST', '/library/:id/speakers', async ({ params, body }) => {
  const doc = (await db.get('library', params.id)) ?? notFound('Document');
  const mapping: Record<string, string> = await body();
  doc.segments = library.mergeSegments((doc.segments ?? []).map((s: any) => ({
    ...s, speaker: s.speaker ? (mapping[s.speaker] || s.speaker).trim() : null })));
  doc.text = library.segmentsToText(doc.segments);
  return library.save(doc);
});

/** Voice notes picked with the browser's folder picker (sent in batches). */
route('POST', '/library/voice-notes', async ({ body }) => {
  const { files } = await body();
  if (!Array.isArray(files)) throw new HttpError(400, 'files[] required');
  return library.importVoiceNotes(files.map((f: any) => ({ path: String(f.path), text: String(f.text ?? ''), modified: f.modified ?? null })));
});

route('POST', '/library/style-guide', async ({ body, origin }) => {
  const { doc_ids, model } = await body();
  if (!Array.isArray(doc_ids) || !doc_ids.length) throw new HttpError(400, 'Select some voice notes');
  const m = model || (await db.getSetting('TRANSCRIBE_MODEL')) || 'gemini-3.8-flash';
  const doc = library.makeDoc('document', `Voice style guide — ${now().slice(0, 10)} (${doc_ids.length} notes)`, '', {
    status: 'processing', meta: { style_guide: true, step: 'distilling your voice with Gemini', model: m } });
  await library.save(doc);
  await jobs.enqueue({ type: 'style_guide', docId: doc.id, sourceIds: doc_ids, model: m }, origin);
  return summary(doc);
});

route('GET', '/podcasts/search', async ({ url }) => podcasts.search(url.searchParams.get('q') ?? ''));
route('GET', '/podcasts/episodes', async ({ url }) => podcasts.episodes(url.searchParams.get('feed_url') ?? ''));
route('POST', '/podcasts/import', async ({ body, origin }) => {
  const b = await body();
  const doc = library.makeDoc('podcast', 'Fetching episode…', '', { status: 'processing', meta: { feed_url: b.feed_url, guid: b.episode_guid, step: 'fetching feed' } });
  await library.save(doc);
  await jobs.enqueue({ type: 'podcast', docId: doc.id, feedUrl: b.feed_url, guid: b.episode_guid, mode: b.mode ?? 'auto' }, origin);
  return summary(doc);
});

// ---------------- models ----------------

const PROVIDERS = ['openai', 'anthropic', 'google', 'openai_compatible', 'mock'];
function modelDoc(b: any, id: string) {
  if (!b.label || !b.model || !PROVIDERS.includes(b.provider)) throw new HttpError(400, 'label, provider and model are required');
  return { id, label: b.label, provider: b.provider, model: b.model, base_url: b.base_url ?? null, api_key_env: b.api_key_env ?? null,
    temperature: b.temperature ?? null, max_tokens: Number(b.max_tokens) || 2048, top_p: b.top_p ?? null, system_prompt: b.system_prompt ?? null,
    price_input_per_mtok: Number(b.price_input_per_mtok) || 0, price_output_per_mtok: Number(b.price_output_per_mtok) || 0 };
}
route('GET', '/models', async () => (await db.all('models')).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })));
route('POST', '/models', async ({ body }) => db.put('models', modelDoc(await body(), newId('m'))));
route('PUT', '/models/:id', async ({ params, body }) => {
  (await db.get('models', params.id)) ?? notFound('Model');
  return db.put('models', modelDoc(await body(), params.id));
});
route('DELETE', '/models/:id', async ({ params }) => { await db.del('models', params.id); return { ok: true }; });
route('POST', '/models/:id/test', async ({ params }) => {
  const m = (await db.get('models', params.id)) ?? notFound('Model');
  try {
    const c = await providers.complete({ provider: m.provider, model: m.model, prompt: 'Reply with exactly: OK', temperature: m.temperature,
      max_tokens: Math.min(256, m.max_tokens ?? 256), base_url: m.base_url, api_key: await providers.keyFor(m.provider, m.api_key_env) });
    return { ok: true, output: c.text.slice(0, 200), input_tokens: c.input_tokens, output_tokens: c.output_tokens };
  } catch (e) { return { ok: false, error: String((e as Error).message).slice(0, 500) }; }
});

// ---------------- suites ----------------

function validateSuite(s: any) {
  if (!s?.name) throw new HttpError(400, 'Suite name is required');
  for (const k of ['cases', 'criteria'] as const) {
    if (!Array.isArray(s[k] ?? [])) throw new HttpError(400, `${k} must be a list`);
    const ids = (s[k] ?? []).map((x: any) => x.id);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, `${k === 'cases' ? 'Case' : 'Criterion'} ids must be unique`);
  }
  for (const c of s.criteria ?? []) if (!(c.scale_max >= 1 && c.scale_max <= 10)) throw new HttpError(400, `Bad scale for ${c.name}`);
  return {
    name: s.name, description: s.description ?? '', system_prompt: s.system_prompt ?? '', global_checks: s.global_checks ?? [],
    context: { doc_ids: [], role: 'voice', max_chars: 24000, share_with_judge: true, ...(s.context ?? {}) },
    criteria: (s.criteria ?? []).map((c: any) => ({ description: '', rubric: '', weight: 1, graded_by: 'both', ...c })),
    cases: (s.cases ?? []).map((c: any) => ({ reference: null, tags: [], checks: [], context_doc_ids: [], source_doc_id: null, ...c })),
  };
}
route('GET', '/suites', async () => (await db.all('suites')).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
route('GET', '/suites/:id', async ({ params }) => (await db.get('suites', params.id)) ?? notFound('Suite'));
route('POST', '/suites', async ({ body }) => db.put('suites', { id: newId('s'), ...validateSuite(await body()) }));
route('PUT', '/suites/:id', async ({ params, body }) => {
  (await db.get('suites', params.id)) ?? notFound('Suite');
  return db.put('suites', { id: params.id, ...validateSuite(await body()) });
});
route('DELETE', '/suites/:id', async ({ params }) => { await db.del('suites', params.id); return { ok: true }; });

// ---------------- runs ----------------

/** Run state with model identities stripped unless revealed; stale workers surface as "interrupted". */
export function publicRun(run: any) {
  const { slots, docs, ...rest } = run;
  const fresh = Date.now() - Date.parse(run.heartbeat ?? 0) < runner.HEARTBEAT_STALE_MS;
  const genActive = ['queued', 'generating'].includes(run.status);
  const judgeActive = ['queued', 'running'].includes(run.judge_status);
  const metaActive = run.meta_status === 'running';
  const out: any = {
    ...rest,
    status: genActive && !fresh ? 'interrupted' : run.status,
    judge_status: judgeActive && !fresh ? 'interrupted' : run.judge_status,
    meta_status: metaActive && !fresh ? 'error' : run.meta_status,
    meta_error: metaActive && !fresh ? 'Interrupted; run it again.' : run.meta_error,
    busy: fresh && (genActive || judgeActive || metaActive),
    doc_titles: Object.fromEntries(Object.entries(docs ?? {}).map(([i, d]: [string, any]) => [i, { title: d.title, kind: d.kind }])),
    slots: slots.map((s: any) => ({ slot: s.slot, ...(run.revealed ? { label: s.model.label, provider: s.model.provider, model: s.model.model } : {}) })),
  };
  return out;
}

const getRun = async (id: string) => (await db.get('runs', id)) ?? notFound('Run');

route('GET', '/runs', async () => {
  const runs = (await db.all('runs')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return runs.map((r) => ({ ...publicRun(r), suite: { id: r.suite.id, name: r.suite.name, cases: r.suite.cases.length } }));
});

route('POST', '/runs', async ({ body, origin }) => {
  const run = await runner.createRun(await body());
  await jobs.enqueue({ type: 'generate', runId: run.id }, origin);
  return publicRun(run);
});

route('GET', '/runs/:id', async ({ params }) => publicRun(await getRun(params.id)));

route('DELETE', '/runs/:id', async ({ params }) => {
  if (publicRun(await getRun(params.id)).busy) throw new HttpError(409, 'Run is still in progress');
  await db.del('runs', params.id);
  return { ok: true };
});

route('POST', '/runs/:id/resume', async ({ params, origin }) => {
  if (publicRun(await getRun(params.id)).busy) throw new HttpError(409, 'Run is busy');
  const gens = (await db.generationsForRun(params.id)).filter((g) => g.status === 'error');
  for (const g of gens) await db.putGeneration({ ...g, status: 'pending', error: null } as any);
  await db.patch('runs', params.id, { status: 'queued', heartbeat: now() });
  await jobs.enqueue({ type: 'generate', runId: params.id }, origin);
  return { ok: true };
});

route('POST', '/runs/:id/judge', async ({ params, body, origin, req }) => {
  if (publicRun(await getRun(params.id)).busy) throw new HttpError(409, 'Run is busy');
  const cfg = req.headers.get('content-length') !== '0' ? await body().catch(() => null) : null;
  await jobs.enqueue(await runner.startJudge(params.id, cfg ?? undefined), origin);
  return { ok: true };
});

route('POST', '/runs/:id/meta-review', async ({ params, origin }) => {
  if (publicRun(await getRun(params.id)).busy) throw new HttpError(409, 'Run is busy');
  await db.patch('runs', params.id, { meta_status: 'running', heartbeat: now() });
  await jobs.enqueue({ type: 'meta', runId: params.id }, origin);
  return { ok: true };
});

route('POST', '/runs/:id/reveal', async ({ params }) => { await getRun(params.id); return publicRun(await db.patch('runs', params.id, { revealed: true, revealed_at: now() })); });
route('POST', '/runs/:id/hide', async ({ params }) => { await getRun(params.id); return publicRun(await db.patch('runs', params.id, { revealed: false })); });

route('GET', '/runs/:id/review', async ({ params, url }) => {
  const run = await getRun(params.id);
  const includeAi = url.searchParams.get('include_ai') === 'true';
  const gens = await db.generationsForRun(params.id);
  const byGen: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const s of await db.scoresForRun(params.id)) {
    if (s.source === 'ai' && !includeAi) continue;
    ((byGen[s.generation_id] ??= {})[s.source] ??= {})[s.criterion_id] = { score: s.score, note: s.note ?? null, rationale: s.rationale ?? null };
  }
  const units: Record<string, any[]> = {};
  for (const g of gens) (units[`${g.case_id}\u0000${g.sample}`] ??= []).push(g);
  const order = Object.fromEntries(run.suite.cases.map((c: any, i: number) => [c.id, i]));
  const perCase = run.blind_mode === 'per_case';
  const labels = Object.fromEntries(run.slots.map((s: any) => [s.slot, s.model.label]));
  return {
    units: Object.entries(units)
      .map(([k, items]) => { const [case_id, sample] = k.split('\u0000'); return { case_id, sample: Number(sample), items }; })
      .sort((a, b) => (order[a.case_id] ?? 0) - (order[b.case_id] ?? 0) || a.sample - b.sample)
      .map(({ case_id, sample, items }) => ({
        case_id, sample,
        items: shuffle(items.sort((a, b) => a.slot.localeCompare(b.slot)), seededRandom(`${run.seed}-${case_id}-${sample}`)).map((g, i) => ({
          generation_id: g.id, display_label: perCase ? `Response ${i + 1}` : `Model ${g.slot}`,
          slot: !perCase || run.revealed ? g.slot : null, status: g.status, output: g.output ?? null, error: g.error ?? null,
          latency_ms: g.latency_ms ?? null, output_tokens: g.output_tokens ?? null, checks: g.checks ?? [],
          human: byGen[g.id]?.human ?? {}, ai: includeAi ? byGen[g.id]?.ai ?? {} : null,
          ...(run.revealed ? { model_label: labels[g.slot] } : {}),
        })),
      })),
  };
});

route('GET', '/runs/:id/docs/:docId', async ({ params }) => (await getRun(params.id)).docs?.[params.docId] ?? notFound('Document'));

route('POST', '/runs/:id/scores', async ({ params, body }) => {
  const run = await getRun(params.id);
  const crit = Object.fromEntries(run.suite.criteria.map((c: any) => [c.id, c]));
  const genIds = new Set((await db.generationsForRun(params.id)).map((g) => g.id));
  const { scores } = await body();
  for (const s of scores ?? []) {
    const c = crit[s.criterion_id];
    if (!c || !genIds.has(s.generation_id)) throw new HttpError(400, 'Unknown generation or criterion');
    const lo = c.scale_max === 1 ? 0 : 1;
    if (!(typeof s.score === 'number' && s.score >= lo && s.score <= c.scale_max)) throw new HttpError(400, `Score for ${c.name} must be between ${lo} and ${c.scale_max}`);
  }
  for (const s of scores ?? []) await db.putScore({ id: newId('sc'), run_id: params.id, generation_id: s.generation_id, source: 'human',
    criterion_id: s.criterion_id, score: s.score, note: s.note ?? null, created_at: now() });
  return { ok: true };
});

async function runStats(id: string) {
  const run = await getRun(id);
  const st: any = stats.compute(run, await db.generationsForRun(id), await db.scoresForRun(id));
  if (run.revealed) {
    const models = Object.fromEntries(run.slots.map((s: any) => [s.slot, s.model]));
    for (const row of st.slots) Object.assign(row, { label: models[row.slot].label, provider: models[row.slot].provider, model: models[row.slot].model });
  } else if (run.blind_mode === 'per_case') for (const d of st.disagreements) d.slot = null;
  return st;
}
route('GET', '/runs/:id/stats', ({ params }) => runStats(params.id));
route('GET', '/runs/:id/export', async ({ params }) => {
  const run = await getRun(params.id);
  return json({ run: publicRun(run), generations: await db.generationsForRun(params.id), scores: await db.scoresForRun(params.id),
    stats: await runStats(params.id) }, 200, { 'content-disposition': `attachment; filename="${run.id}.json"` });
});
