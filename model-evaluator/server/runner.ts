/** Run orchestration: generate outputs, run auto-checks, run the AI judge, the meta-review and voice style guides. */
import { randomInt } from 'node:crypto';
import * as db from './db.ts';
import * as judgeLib from './judge.ts';
import * as library from './library.ts';
import * as prompting from './prompting.ts';
import * as providers from './providers.ts';
import * as stats from './stats.ts';
import { runChecks } from './checks.ts';
import type { Job } from './jobs.ts';
import { HttpError, newId, now, pool, seededRandom, shuffle } from './util.ts';

/** Stop starting new model calls this long before the invocation's budget ends (≤ 90 s, scaled for short budgets). */
const canStart = (deadline: number, start = Date.now()) => {
  const safety = Math.min(90_000, (deadline - start) / 4);
  return () => Date.now() < deadline - safety;
};

export const HEARTBEAT_STALE_MS = 5 * 60_000;

export interface RunCreate {
  name?: string; suite_id: string; model_ids: string[]; samples_per_case?: number; concurrency?: number;
  blind_mode?: 'consistent' | 'per_case'; judge?: Partial<JudgeConfig>;
}
export interface JudgeConfig { enabled: boolean; model: string; mode: 'individual' | 'comparative'; include_reference: boolean; temperature: number; auto_run: boolean }
export const DEFAULT_JUDGE: JudgeConfig = { enabled: true, model: 'gemini-3.8-flash', mode: 'individual', include_reference: true, temperature: 0, auto_run: true };

function heartbeat(runId: string) {
  let last = 0;
  return async (force = false) => {
    if (force || Date.now() - last > 15_000) { last = Date.now(); await db.patch('runs', runId, { heartbeat: now() }); }
  };
}

export async function createRun(req: RunCreate) {
  const suite = await db.get('suites', req.suite_id);
  if (!suite) throw new HttpError(400, 'Suite not found');
  if (!suite.cases?.length) throw new HttpError(400, 'Suite has no test cases');
  if (!req.model_ids?.length || req.model_ids.length > 12) throw new HttpError(400, 'Pick 1–12 models');
  const samples = Math.max(1, Math.min(10, Math.floor(req.samples_per_case ?? 1)));
  const models = [];
  for (const mid of req.model_ids) {
    const m = await db.get('models', mid);
    if (!m) throw new HttpError(400, `Model ${mid} not found`);
    models.push(m);
  }
  // Blind assignment: shuffle which model gets which anonymous letter.
  const slots = shuffle(models, () => randomInt(0, 2 ** 31) / 2 ** 31).map((m, i) => ({ slot: String.fromCharCode(65 + i), model: m }));
  const docIds = [...(suite.context?.doc_ids ?? []), ...suite.cases.flatMap((c: any) => c.context_doc_ids ?? [])];
  const run = {
    id: newId('run'),
    name: req.name || `${suite.name} · ${new Date().toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`,
    created_at: now(), suite, docs: await library.resolve([...new Set(docIds)]), slots, samples_per_case: samples,
    concurrency: Math.max(1, Math.min(32, Math.floor(req.concurrency ?? 4))), blind_mode: req.blind_mode ?? 'consistent',
    judge: { ...DEFAULT_JUDGE, ...(req.judge ?? {}) }, seed: randomInt(0, 2 ** 31), status: 'queued', revealed: false,
    judge_status: 'idle', judge_errors: [] as string[], meta_review: null, meta_status: 'idle', heartbeat: now(),
  };
  await db.put('runs', run);
  const gens = [];
  for (const c of suite.cases) for (let s = 0; s < samples; s++) for (const sl of slots)
    gens.push({ id: newId('gen'), run_id: run.id, case_id: c.id, sample: s, slot: sl.slot, status: 'pending', output: null, error: null });
  await db.putGenerations(gens);
  return run;
}

export async function generate(runId: string, deadline: number): Promise<Job | null> {
  let run = await db.patch('runs', runId, { status: 'generating', heartbeat: now() });
  if (!run.started_at) run = await db.patch('runs', runId, { started_at: now() });
  const suite = run.suite;
  const cases = Object.fromEntries(suite.cases.map((c: any) => [c.id, c]));
  const slotModels = Object.fromEntries(run.slots.map((s: any) => [s.slot, s.model]));
  const pending = (await db.generationsForRun(runId)).filter((g) => g.status === 'pending');
  const beat = heartbeat(runId);

  await pool(pending, run.concurrency, async (gen) => {
    const m = slotModels[gen.slot];
    const kase = cases[gen.case_id];
    const t0 = Date.now();
    try {
      const comp = await providers.complete({
        provider: m.provider, model: m.model, prompt: prompting.userPrompt(run, kase), system: prompting.systemPrompt(run, kase, m),
        temperature: m.temperature, max_tokens: m.max_tokens ?? 2048, top_p: m.top_p, base_url: m.base_url,
        api_key: await providers.keyFor(m.provider, m.api_key_env),
      });
      Object.assign(gen, {
        status: 'done', error: null, output: comp.text, latency_ms: Date.now() - t0,
        input_tokens: comp.input_tokens, output_tokens: comp.output_tokens,
        cost_usd: (comp.input_tokens * (m.price_input_per_mtok ?? 0) + comp.output_tokens * (m.price_output_per_mtok ?? 0)) / 1e6,
        checks: runChecks([...(kase.checks ?? []), ...(suite.global_checks ?? [])], comp.text, kase.reference, kase.input),
      });
    } catch (e) {
      Object.assign(gen, { status: 'error', error: String((e as Error).message ?? e).slice(0, 1000), latency_ms: Date.now() - t0 });
    }
    await db.putGeneration(gen as any);
    await beat();
  }, canStart(deadline));

  const gens = await db.generationsForRun(runId);
  if (gens.some((g) => g.status === 'pending')) return { type: 'generate', runId };
  run = await db.patch('runs', runId, { status: 'generated', finished_at: now(), error_count: gens.filter((g) => g.status === 'error').length, heartbeat: now() });
  if (run.judge.enabled && run.judge.auto_run !== false) return startJudge(runId);
  await db.patch('runs', runId, { status: 'ready' });
  return null;
}

/** Reset AI scores and return the first judge job. */
export async function startJudge(runId: string, cfg?: Partial<JudgeConfig>): Promise<Job> {
  const run = (await db.get('runs', runId))!;
  await db.deleteScores(runId, 'ai');
  await db.patch('runs', runId, {
    judge: { ...run.judge, ...(cfg ?? {}), enabled: true }, judge_status: 'running', judge_errors: [],
    judge_started_at: now(), judge_tokens: { in: 0, out: 0 }, heartbeat: now(),
  });
  return { type: 'judge', runId, attempted: [] };
}

export async function judge(runId: string, attempted: string[], deadline: number): Promise<Job | null> {
  const run = (await db.get('runs', runId))!;
  const cfg = run.judge;
  const suite = run.suite;
  const cases = Object.fromEntries(suite.cases.map((c: any) => [c.id, c]));
  const aiCrit = suite.criteria.filter((c: any) => ['ai', 'both'].includes(c.graded_by ?? 'both'));
  if (!aiCrit.length) {
    await db.patch('runs', runId, { judge_status: 'skipped', ...(run.status === 'generated' ? { status: 'ready' } : {}) });
    return null;
  }
  const done = new Set(attempted);
  const errors: string[] = [...(run.judge_errors ?? [])];
  const tokens = { in: run.judge_tokens?.in ?? 0, out: run.judge_tokens?.out ?? 0 };
  const gens = (await db.generationsForRun(runId)).filter((g) => g.status === 'done');
  const beat = heartbeat(runId);

  const save = async (gen: any, items: any[]) => {
    const byId = Object.fromEntries((items ?? []).map((it: any) => [it?.criterion_id, it]));
    for (const c of aiCrit) {
      const it = byId[c.id];
      if (!it) { errors.push(`${gen.case_id}/${gen.slot}: judge omitted criterion ${c.id}`); continue; }
      try {
        await db.putScore({ id: newId('sc'), run_id: runId, generation_id: gen.id, source: 'ai', criterion_id: c.id,
          score: judgeLib.clamp(it.score, c.scale_max), rationale: String(it.rationale ?? '').slice(0, 2000), created_at: now() });
      } catch (e) { errors.push(`${gen.case_id}/${gen.slot}: ${(e as Error).message}`); }
    }
  };

  type Unit = { key: string; gens: any[] };
  let units: Unit[];
  if (cfg.mode === 'comparative') {
    const by: Record<string, any[]> = {};
    for (const g of gens) (by[`${g.case_id}|${g.sample}`] ??= []).push(g);
    units = Object.entries(by).map(([key, gs]) => ({ key, gens: gs }));
  } else units = gens.map((g) => ({ key: g.id, gens: [g] }));
  const todo = units.filter((u) => !done.has(u.key));

  await pool(todo, Math.max(1, Math.min(run.concurrency, 8)), async (u) => {
    const kase = cases[u.gens[0].case_id];
    try {
      if (cfg.mode === 'comparative') {
        const order = shuffle([...u.gens].sort((a, b) => a.slot.localeCompare(b.slot)), seededRandom(`${run.seed}-judge-${u.key}`));
        const labelled: Record<string, any> = Object.fromEntries(order.map((g, i) => [`Response ${i + 1}`, g]));
        const prompt = judgeLib.buildComparativePrompt(run, kase, aiCrit, Object.entries(labelled).map(([l, g]) => [l, g.output ?? '']), cfg.include_reference);
        const { data, comp } = await judgeLib.callJudge(cfg, prompt);
        tokens.in += comp.input_tokens; tokens.out += comp.output_tokens;
        for (const ev of data.evaluations ?? []) if (labelled[ev?.label]) await save(labelled[ev.label], ev.scores);
      } else {
        const g = u.gens[0];
        const prompt = judgeLib.buildIndividualPrompt(run, kase, aiCrit, g.output ?? '', cfg.include_reference);
        const { data, comp } = await judgeLib.callJudge(cfg, prompt);
        tokens.in += comp.input_tokens; tokens.out += comp.output_tokens;
        await save(g, data.scores);
      }
    } catch (e) {
      errors.push(`${u.gens[0].case_id}${cfg.mode === 'comparative' ? '' : `/${u.gens[0].slot}`}: ${String((e as Error).message).slice(0, 300)}`);
    }
    done.add(u.key);
    await beat();
  }, canStart(deadline));

  if (todo.some((u) => !done.has(u.key))) {
    await db.patch('runs', runId, { judge_errors: errors.slice(0, 50), judge_tokens: tokens, heartbeat: now() });
    return { type: 'judge', runId, attempted: [...done] };
  }
  const cur = (await db.get('runs', runId))!;
  await db.patch('runs', runId, {
    judge_status: errors.length ? 'done_with_errors' : 'done', judge_errors: errors.slice(0, 50), judge_finished_at: now(),
    judge_tokens: tokens, ...(cur.status === 'generated' ? { status: 'ready' } : {}),
  });
  return null;
}

export async function metaReview(runId: string) {
  const run = await db.patch('runs', runId, { meta_status: 'running', meta_error: null, heartbeat: now() });
  try {
    const gens = await db.generationsForRun(runId);
    const scores = await db.scoresForRun(runId);
    const st = stats.compute(run, gens, scores);
    const genById = Object.fromEntries(gens.map((g) => [g.id, g]));
    const cases = Object.fromEntries(run.suite.cases.map((c: any) => [c.id, c]));
    const disagreements = st.disagreements.slice(0, 10).map((d: any) => {
      const g = genById[d.generation_id];
      const ai = scores.find((s) => s.generation_id === g.id && s.source === 'ai' && s.criterion_id === d.criterion_id);
      return { case_id: d.case_id, slot: d.slot, criterion_id: d.criterion_id, human: d.human, ai: d.ai,
        task: cases[g.case_id].input.slice(0, 600), output: (g.output ?? '').slice(0, 1500), ai_rationale: ai?.rationale ?? null };
    });
    const examples = run.suite.cases.slice(0, 4).flatMap((c: any) => gens.filter((g) => g.case_id === c.id && g.sample === 0 && g.status === 'done')
      .map((g) => ({ case_id: c.id, slot: g.slot, output: (g.output ?? '').slice(0, 800) })));
    const lean = { leaderboard: st.slots, cases: st.cases, agreement: st.agreement, bias: st.bias, progress: st.progress };
    const { data } = await judgeLib.callJudge(run.judge, judgeLib.buildMetaPrompt(run.suite, lean, disagreements, examples), judgeLib.META_SYSTEM);
    await db.patch('runs', runId, { meta_status: 'done', meta_review: { ...data, created_at: now(), model: run.judge.model } });
  } catch (e) {
    await db.patch('runs', runId, { meta_status: 'error', meta_error: String((e as Error).message ?? e).slice(0, 1000) });
  }
}

const STYLE_INPUT_CHARS = 600_000; // ~150k tokens: plenty for a year of voice notes

export async function styleGuide(docId: string, sourceIds: string[], model: string) {
  const doc = (await db.get('library', docId))!;
  try {
    const notes: any[] = [];
    let used = 0;
    const sources = (await Promise.all(sourceIds.map((i) => db.get('library', i)))).filter(Boolean) as db.Doc[];
    sources.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    for (const n of sources) {
      if (used + (n.text?.length ?? 0) > STYLE_INPUT_CHARS) break;
      notes.push({ title: n.title, created_at: n.created_at, text: n.text });
      used += n.text?.length ?? 0;
    }
    if (!notes.length) throw new Error('No voice notes selected');
    const comp = await judgeLib.callGemini({ model, temperature: 0.3 }, judgeLib.buildStylePrompt(notes), judgeLib.STYLE_SYSTEM, false, 8192);
    Object.assign(doc, { text: comp.text.trim(), status: 'ready', error: null,
      meta: { ...doc.meta, step: null, notes_used: notes.length, notes_selected: sourceIds.length, model } });
  } catch (e) {
    Object.assign(doc, { status: 'error', error: String((e as Error).message ?? e).slice(0, 800) });
  }
  await library.save(doc);
}
