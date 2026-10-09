/** Aggregate generations + scores into leaderboard, per-criterion, agreement and per-case stats. */

export const normalize = (score: number, scaleMax: number) => (scaleMax === 1 ? Number(score) : (Number(score) - 1) / (scaleMax - 1));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r = (x: number | null | undefined, nd = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** nd) / 10 ** nd);
const pstdev = (xs: number[]) => { const m = mean(xs)!; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length); };

function pct(xs: number[], p: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = (s.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
}

export function pearson(xs: number[], ys: number[]) {
  if (xs.length < 3) return null;
  const mx = mean(xs)!, my = mean(ys)!;
  const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  if (!sx || !sy) return null;
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (sx * sy);
}

function weighted(byCrit: Record<string, number>, weights: Record<string, number>) {
  const keys = Object.keys(byCrit).filter((c) => c in weights);
  const tot = keys.reduce((a, c) => a + weights[c], 0);
  return tot ? keys.reduce((a, c) => a + byCrit[c] * weights[c], 0) / tot : null;
}

export function compute(run: any, generations: any[], scores: any[]) {
  const suite = run.suite;
  const criteria: Record<string, any> = Object.fromEntries(suite.criteria.map((c: any) => [c.id, c]));
  const weights: Record<string, number> = Object.fromEntries(suite.criteria.map((c: any) => [c.id, c.weight ?? 1]));
  const slots: string[] = run.slots.map((s: any) => s.slot);

  const byGen: Record<string, Record<string, Record<string, number>>> = {};
  const raw = new Map<string, number>();
  const key = (g: string, s: string, c: string) => `${g}|${s}|${c}`;
  for (const s of scores) {
    const c = criteria[s.criterion_id];
    if (!c) continue;
    ((byGen[s.generation_id] ??= {})[s.source] ??= {})[c.id] = normalize(s.score, c.scale_max);
    raw.set(key(s.generation_id, s.source, c.id), s.score);
  }
  const src = (g: string, s: string) => byGen[g]?.[s] ?? {};

  const genScores: Record<string, { human: number | null; ai: number | null; final: number | null }> = {};
  for (const g of generations) {
    genScores[g.id] = {
      human: weighted(src(g.id, 'human'), weights), ai: weighted(src(g.id, 'ai'), weights),
      final: weighted({ ...src(g.id, 'ai'), ...src(g.id, 'human') }, weights), // human overrides AI
    };
  }

  // ---- per-slot leaderboard ----
  const slotRows = slots.map((slot) => {
    const gens = generations.filter((g) => g.slot === slot);
    const ok = gens.filter((g) => !g.error && g.status === 'done');
    const checks = ok.flatMap((g) => (g.checks ?? []).map((c: any) => c.passed));
    const lat = ok.map((g) => g.latency_ms).filter((x) => x != null);
    const crit: Record<string, any> = {};
    for (const cid of Object.keys(criteria)) {
      const h = ok.map((g) => src(g.id, 'human')[cid]).filter((x) => x !== undefined);
      const a = ok.map((g) => src(g.id, 'ai')[cid]).filter((x) => x !== undefined);
      const hr = ok.map((g) => raw.get(key(g.id, 'human', cid))).filter((x): x is number => x !== undefined);
      const ar = ok.map((g) => raw.get(key(g.id, 'ai', cid))).filter((x): x is number => x !== undefined);
      crit[cid] = { human: h.length ? r(mean(h)! * 100) : null, ai: a.length ? r(mean(a)! * 100) : null,
        human_raw: r(mean(hr), 2), ai_raw: r(mean(ar), 2), human_n: h.length, ai_n: a.length };
    }
    const avg = (k: 'human' | 'ai' | 'final') => {
      const vals = ok.map((g) => genScores[g.id][k]).filter((x): x is number => x !== null);
      return vals.length ? r(mean(vals)! * 100) : null;
    };
    const perCase: Record<string, number[]> = {};
    for (const g of ok) if (genScores[g.id].final !== null) (perCase[g.case_id] ??= []).push(genScores[g.id].final!);
    const stds = Object.values(perCase).filter((v) => v.length > 1).map(pstdev);
    return {
      slot, generations: gens.length, completed: ok.length, errors: gens.filter((g) => g.error).length,
      auto_pass_rate: checks.length ? r((checks.filter(Boolean).length / checks.length) * 100) : null, auto_checks_run: checks.length,
      human_score: avg('human'), ai_score: avg('ai'), final_score: avg('final'), criteria: crit,
      latency_avg_ms: r(mean(lat), 0), latency_p50_ms: r(pct(lat, 0.5), 0), latency_p95_ms: r(pct(lat, 0.95), 0),
      input_tokens: ok.reduce((a, g) => a + (g.input_tokens ?? 0), 0), output_tokens: ok.reduce((a, g) => a + (g.output_tokens ?? 0), 0),
      avg_output_tokens: r(mean(ok.map((g) => g.output_tokens ?? 0)), 0),
      avg_output_words: r(mean(ok.map((g) => (g.output ?? '').split(/\s+/).filter(Boolean).length)), 0),
      cost_usd: Math.round(ok.reduce((a, g) => a + (g.cost_usd ?? 0), 0) * 1e6) / 1e6,
      consistency_std: stds.length ? r(mean(stds)! * 100) : null,
      wins: 0, losses: 0, ties: 0, win_rate: null as number | null,
    };
  });
  const rowBySlot = Object.fromEntries(slotRows.map((x) => [x.slot, x]));

  // ---- pairwise win rate per (case, sample) ----
  const units: Record<string, Record<string, any>> = {};
  for (const g of generations) (units[`${g.case_id}\u0000${g.sample}`] ??= {})[g.slot] = g;
  const caseSpread: Record<string, Record<string, number[]>> = {};
  for (const [k, bySlot] of Object.entries(units)) {
    const caseId = k.split('\u0000')[0];
    const vals: Record<string, number> = {};
    for (const [slot, g] of Object.entries(bySlot)) {
      let v = genScores[g.id].final;
      if (g.error) v = 0;
      if (v !== null) { vals[slot] = v; ((caseSpread[caseId] ??= {})[slot] ??= []).push(v); }
    }
    const ss = Object.keys(vals);
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i], b = ss[j];
      if (Math.abs(vals[a] - vals[b]) < 1e-9) { rowBySlot[a].ties++; rowBySlot[b].ties++; }
      else if (vals[a] > vals[b]) { rowBySlot[a].wins++; rowBySlot[b].losses++; }
      else { rowBySlot[b].wins++; rowBySlot[a].losses++; }
    }
  }
  for (const x of slotRows) {
    const n = x.wins + x.losses + x.ties;
    x.win_rate = n ? r(((x.wins + 0.5 * x.ties) / n) * 100) : null;
  }

  // ---- per-case discrimination ----
  const cases = suite.cases.map((c: any) => {
    const perSlot: Record<string, number> = {};
    for (const [s, v] of Object.entries(caseSpread[c.id] ?? {})) if (v.length) perSlot[s] = r(mean(v)! * 100)!;
    const vals = Object.values(perSlot);
    return { case_id: c.id, input: c.input.slice(0, 160), tags: c.tags ?? [], per_slot: perSlot,
      mean: vals.length ? r(mean(vals)) : null, spread: vals.length > 1 ? r(Math.max(...vals) - Math.min(...vals)) : null };
  });

  // ---- human vs AI agreement ----
  const agreement: any = { by_criterion: {}, overall: null };
  const allH: number[] = [], allA: number[] = [];
  const disagreements: any[] = [];
  for (const [cid, c] of Object.entries(criteria)) {
    const hs: number[] = [], as: number[] = [];
    for (const g of generations) {
      const h = src(g.id, 'human')[cid], a = src(g.id, 'ai')[cid];
      if (h === undefined || a === undefined) continue;
      hs.push(h); as.push(a);
      disagreements.push({ generation_id: g.id, case_id: g.case_id, slot: g.slot, criterion_id: cid,
        human: raw.get(key(g.id, 'human', cid)), ai: raw.get(key(g.id, 'ai', cid)), diff: Math.abs(h - a) });
    }
    allH.push(...hs); allA.push(...as);
    if (hs.length) {
      const step = c.scale_max === 1 ? 1 : 1 / (c.scale_max - 1);
      agreement.by_criterion[cid] = {
        n: hs.length, pearson: r(pearson(hs, as), 3), mae: r(mean(hs.map((h, i) => Math.abs(h - as[i])))! * 100),
        within_one_point: r((hs.filter((h, i) => Math.abs(h - as[i]) <= step + 1e-9).length / hs.length) * 100),
        ai_bias: r((mean(as)! - mean(hs)!) * 100),
      };
    }
  }
  if (allH.length) {
    agreement.overall = { n: allH.length, pearson: r(pearson(allH, allA), 3),
      mae: r(mean(allH.map((h, i) => Math.abs(h - allA[i])))! * 100), ai_bias: r((mean(allA)! - mean(allH)!) * 100) };
  }
  agreement.human_ranking = slotRows.filter((x) => x.human_score !== null).sort((a, b) => b.human_score! - a.human_score!).map((x) => x.slot);
  agreement.ai_ranking = slotRows.filter((x) => x.ai_score !== null).sort((a, b) => b.ai_score! - a.ai_score!).map((x) => x.slot);
  disagreements.sort((a, b) => b.diff - a.diff);

  // ---- length bias ----
  const len = (g: any) => (g.output ?? '').split(/\s+/).filter(Boolean).length;
  const aiG = generations.filter((g) => genScores[g.id]?.ai != null);
  const huG = generations.filter((g) => genScores[g.id]?.human != null);
  const bias = {
    ai_score_vs_length_r: r(pearson(aiG.map(len), aiG.map((g) => genScores[g.id].ai!)), 3),
    human_score_vs_length_r: r(pearson(huG.map(len), huG.map((g) => genScores[g.id].human!)), 3),
  };

  const humanCrit = Object.keys(criteria).filter((c) => ['human', 'both'].includes(criteria[c].graded_by ?? 'both'));
  const aiCrit = Object.keys(criteria).filter((c) => ['ai', 'both'].includes(criteria[c].graded_by ?? 'both'));
  const done = generations.filter((g) => g.status === 'done' && !g.error);
  const progress = {
    generations_total: generations.length,
    generations_done: generations.filter((g) => g.status === 'done' || g.status === 'error').length,
    human_needed: done.length * humanCrit.length,
    human_done: done.reduce((a, g) => a + humanCrit.filter((c) => src(g.id, 'human')[c] !== undefined).length, 0),
    ai_needed: done.length * aiCrit.length,
    ai_done: done.reduce((a, g) => a + aiCrit.filter((c) => src(g.id, 'ai')[c] !== undefined).length, 0),
  };
  return { slots: slotRows, cases, agreement, disagreements: disagreements.slice(0, 25), bias, progress };
}
