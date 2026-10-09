/** AI judge (Gemini by default): scores outputs blind, audits the eval, and distils voice style guides. */
import { createHash } from 'node:crypto';
import * as providers from './providers.ts';
import { caseDocuments, contextBlock } from './prompting.ts';
import { seededRandom } from './util.ts';

export const JUDGE_SYSTEM = `You are a meticulous, impartial evaluator of AI model responses.
- You do NOT know which model wrote any response; never guess or mention model identities.
- Grade strictly against the criteria and rubric provided. Use the full scale.
- Do not reward length, confidence or formatting for its own sake.
- If a reference answer is given, use it as the gold standard for correctness, but accept equivalent answers.
- Keep each rationale to 1-3 sentences citing concrete evidence from the response.
- Respond with JSON only, exactly matching the requested schema.`;

const scaleText = (m: number) => (m === 1 ? '0 (fail) or 1 (pass)' : `integer 1 to ${m} (${m} = best)`);

export function criteriaBlock(criteria: any[]): string {
  return criteria.map((c) => {
    const lines = [`- id: "${c.id}"\n  name: ${c.name}\n  scale: ${scaleText(c.scale_max)}`];
    if (c.description) lines.push(`  description: ${c.description}`);
    if (c.rubric) lines.push(`  rubric: ${c.rubric.replace(/\n/g, '\n    ')}`);
    return lines.join('\n');
  }).join('\n');
}

function taskBlock(run: any, kase: any, includeReference: boolean): string {
  const suite = run.suite;
  const parts: string[] = [];
  if (suite.system_prompt) parts.push(`<system_prompt_given_to_model>\n${suite.system_prompt}\n</system_prompt_given_to_model>`);
  if ((suite.context ?? {}).share_with_judge ?? true) {
    const ctx = contextBlock(run, kase);
    if (ctx) parts.push(`The model was given this personal context about the user. Use it to judge voice/tone match and personalisation.\n<personal_context>\n${ctx}\n</personal_context>`);
  }
  const docs = caseDocuments(run, kase);
  if (docs) parts.push(`<source_material_given_to_model>\n${docs}\n</source_material_given_to_model>`);
  parts.push(`<task>\n${kase.input}\n</task>`);
  if (includeReference && kase.reference) parts.push(`<reference_answer>\n${kase.reference}\n</reference_answer>`);
  return parts.join('\n\n');
}

export const buildIndividualPrompt = (run: any, kase: any, criteria: any[], output: string, includeRef: boolean) =>
  `${taskBlock(run, kase, includeRef)}

<response>
${output}
</response>

Criteria:
${criteriaBlock(criteria)}

Return JSON: {"scores": [{"criterion_id": "<id>", "score": <number>, "rationale": "<why>"}, ...]}
Include every criterion id exactly once.`;

export const buildComparativePrompt = (run: any, kase: any, criteria: any[], labelled: [string, string][], includeRef: boolean) =>
  `${taskBlock(run, kase, includeRef)}

Several anonymous responses to the same task follow, in random order. Grade each one on its own merits
against the criteria, but use the comparison to calibrate your scores consistently.

${labelled.map(([l, t]) => `<response label="${l}">\n${t}\n</response>`).join('\n\n')}

Criteria:
${criteriaBlock(criteria)}

Return JSON: {"evaluations": [{"label": "<response label>", "scores": [{"criterion_id": "<id>", "score": <number>, "rationale": "<why>"}]}]}
Include every response label and every criterion id.`;

export function parseJson(text: string): any {
  let t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) t = fenced[1];
  try { return JSON.parse(t); } catch {
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s !== -1 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new providers.ProviderError(`Judge did not return JSON: ${t.slice(0, 200)}`);
  }
}

export function clamp(score: unknown, scaleMax: number): number {
  const s = Number(score);
  if (score === null || score === undefined || Number.isNaN(s)) throw new providers.ProviderError(`Non-numeric score ${JSON.stringify(score)}`);
  return Math.max(scaleMax === 1 ? 0 : 1, Math.min(scaleMax, Math.round(s)));
}

export async function callGemini(cfg: { model: string; temperature?: number }, prompt: string, system: string, json = true, maxTokens = 8192) {
  if (cfg.model.startsWith('mock')) return mockJudge(prompt);
  return providers.complete({ provider: 'google', model: cfg.model, prompt, system, temperature: cfg.temperature ?? 0,
    max_tokens: maxTokens, json_mode: json, api_key: await providers.keyFor('google') });
}

export async function callJudge(cfg: { model: string; temperature?: number }, prompt: string, system = JUDGE_SYSTEM) {
  const comp = await callGemini(cfg, prompt, system);
  return { data: parseJson(comp.text), comp };
}

/** Deterministic fake judge for tests and offline demos. */
function mockJudge(prompt: string): providers.Completion {
  const rand = seededRandom(createHash('sha256').update(prompt).digest('hex').slice(0, 8));
  const crit = [...prompt.matchAll(/- id: "([^"]+)"\n {2}name: .*\n {2}scale: (0 \(fail\)|integer 1 to (\d+))/g)];
  const scoreFor = (text: string) => crit.map(([, id, kind, mx]) => {
    const good = text.includes('careful answer');
    let s: number;
    if (kind.startsWith('0')) s = good || rand() < 0.2 ? 1 : 0;
    else { const m = Number(mx); s = good ? m - Math.floor(rand() * 2) : 1 + Math.floor(rand() * Math.max(1, Math.floor(m / 2))); s = Math.max(1, Math.min(m, s)); }
    return { criterion_id: id, score: s, rationale: 'mock judge rationale' };
  });
  let body: unknown;
  if (prompt.includes('<style_guide_request>')) {
    return { text: '# Voice style guide (mock)\n\n- Casual, direct, uses "honestly" and "like" a lot.\n\n## Excerpts\n> "kind of mad I waited three weeks"', input_tokens: prompt.length / 4, output_tokens: 40 };
  } else if (prompt.includes('<review_request>')) {
    body = { overall_quality: 6, summary: 'Mock review of the eval.', strengths: ['Clear criteria'],
      issues: [{ severity: 'medium', title: 'Few cases', detail: 'Add more cases.' }], non_discriminative_cases: [],
      criteria_feedback: [], suggested_cases: [], judge_reliability: 'Mock.', recommendations: ['Add harder cases.'] };
  } else if (prompt.includes('<response label="')) {
    const labels = [...prompt.matchAll(/<response label="([^"]+)">\n([\s\S]*?)\n<\/response>/g)];
    body = { evaluations: labels.map(([, l, t]) => ({ label: l, scores: scoreFor(t) })) };
  } else {
    const r = prompt.match(/<response>\n([\s\S]*?)\n<\/response>/);
    body = { scores: scoreFor(r?.[1] ?? '') };
  }
  const text = JSON.stringify(body);
  return { text, input_tokens: Math.floor(prompt.length / 4), output_tokens: Math.floor(text.length / 4) };
}

// ---- meta-review: the AI evaluates the evaluation ----

export const META_SYSTEM = `You are an expert in LLM evaluation methodology. You audit evaluation suites and their results
to judge whether the eval is actually measuring what it claims, and how to make it better. Be concrete and critical.
Model identities are hidden from you on purpose; refer to models only by their anonymous labels. Respond with JSON only.`;

export function buildMetaPrompt(suite: any, stats: any, disagreements: any[], examples: any[]): string {
  const suiteView = {
    name: suite.name, description: suite.description ?? '', system_prompt: suite.system_prompt ?? '',
    criteria: suite.criteria ?? [], global_checks: suite.global_checks ?? [],
    cases: (suite.cases ?? []).map((c: any) => ({ id: c.id, input: c.input, reference: c.reference, tags: c.tags, checks: c.checks })),
  };
  const cap = (v: unknown, n: number) => JSON.stringify(v, null, 2).slice(0, n);
  return `<review_request>
Audit this evaluation. Assess: are the test cases representative, varied and hard enough to separate models?
Are criteria well-defined, non-overlapping, and gradable? Are the rubrics/scales calibrated? Do human and AI-judge
scores agree, and where they don't, which looks more right and why? Are there signs of bias (length, position,
formatting)? Which cases fail to discriminate between models? What should be added or changed?
</review_request>

<eval_suite>
${cap(suiteView, 30000)}
</eval_suite>

<aggregate_results>
${cap(stats, 20000)}
</aggregate_results>

<largest_human_vs_ai_disagreements>
${cap(disagreements, 12000)}
</largest_human_vs_ai_disagreements>

<sample_outputs>
${cap(examples, 15000)}
</sample_outputs>

Return JSON with this shape:
{
  "overall_quality": <integer 1-10 rating of the eval's design and reliability>,
  "summary": "<3-5 sentence verdict>",
  "strengths": ["..."],
  "issues": [{"severity": "high|medium|low", "title": "...", "detail": "..."}],
  "non_discriminative_cases": [{"case_id": "...", "why": "..."}],
  "criteria_feedback": [{"criterion_id": "...", "feedback": "...", "suggested_rubric": "..."}],
  "suggested_cases": [{"input": "...", "reference": "...", "why": "..."}],
  "judge_reliability": "<assessment of human vs AI-judge agreement and what it implies>",
  "recommendations": ["..."]
}`;
}

// ---- voice style guide: distil many voice notes into a compact, reusable profile ----

export const STYLE_SYSTEM = `You are a linguist and ghostwriter. You study how one specific person talks and writes,
and produce a precise, practical style guide another writer could use to sound exactly like them.`;

export function buildStylePrompt(notes: { title: string; created_at?: string | null; text: string }[]): string {
  return `<style_guide_request>
Below are ${notes.length} transcripts of one person's voice notes and writing. Write a voice style guide for them in Markdown:
1. **Overall voice**: 3-5 sentences on tone, energy, warmth, directness, humour.
2. **Vocabulary & signature phrases**: words and phrases they actually use (quote them), slang, fillers they lean on.
3. **Sentence rhythm & structure**: length, run-ons, how they start/end thoughts, asides, questions.
4. **Punctuation & formatting habits** when written down.
5. **What they never sound like**: registers, words or tones that would feel fake for them.
6. **Recurring themes & context**: people, projects and concerns that come up (brief, factual).
7. **Representative excerpts**: 10-15 short verbatim excerpts (1-3 sentences) that best capture the voice.
Be specific to this person; avoid generic advice. Don't invent facts.
</style_guide_request>

${notes.map((n) => `<note title="${n.title}" date="${(n.created_at ?? '').slice(0, 10)}">\n${n.text}\n</note>`).join('\n\n')}`;
}
