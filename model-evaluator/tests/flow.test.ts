import { describe, expect, it } from 'vitest';
import { api, useFreshApp, waitForRun } from './helpers.ts';
import { runCheck } from '../server/checks.ts';

describe('blind evaluation flow (mock models + mock judge)', () => {
  useFreshApp();

  it('runs, scores blind, audits, reveals', async () => {
    const models = (await api('GET', '/models')).json;
    const mockIds = models.filter((m: any) => m.provider === 'mock').map((m: any) => m.id);
    expect(mockIds).toHaveLength(3);
    const suite = (await api('GET', '/suites/s_starter')).json;

    const created = await api('POST', '/runs', { suite_id: suite.id, model_ids: mockIds, samples_per_case: 2,
      judge: { enabled: true, model: 'mock-judge', mode: 'individual' } });
    expect(created.status).toBe(200);
    expect(created.json.slots.every((s: any) => Object.keys(s).join() === 'slot')).toBe(true);
    const run = await waitForRun(created.json.id);
    expect(run.judge_status).toBe('done');

    const review = (await api('GET', `/runs/${run.id}/review`)).json;
    expect(review.units).toHaveLength(suite.cases.length * 2);
    expect(review.units[0].items[0].ai).toBeNull();
    expect(review.units[0].items[0].model_label).toBeUndefined();

    const humanCrit = suite.criteria.filter((c: any) => c.graded_by !== 'ai');
    const scores = review.units.flatMap((u: any) => u.items.flatMap((it: any) => humanCrit.map((c: any) => ({
      generation_id: it.generation_id, criterion_id: c.id,
      score: (it.output ?? '').includes('careful answer') ? c.scale_max : c.scale_max === 1 ? 0 : 1 }))));
    expect((await api('POST', `/runs/${run.id}/scores`, { scores })).status).toBe(200);
    expect((await api('POST', `/runs/${run.id}/scores`, { scores: [{ ...scores[0], score: 99 }] })).status).toBe(400);

    let st = (await api('GET', `/runs/${run.id}/stats`)).json;
    expect(st.progress.human_done).toBe(st.progress.human_needed);
    expect(st.progress.ai_done).toBe(st.progress.ai_needed);
    expect(st.slots.every((r: any) => r.label === undefined && r.win_rate !== null)).toBe(true);
    expect(st.agreement.overall.n).toBeGreaterThan(0);

    expect((await api('POST', `/runs/${run.id}/meta-review`)).status).toBe(200);
    const audited = await waitForRun(run.id, (r) => r.meta_status === 'done');
    expect(audited.meta_review.summary).toBeTruthy();

    const revealed = (await api('POST', `/runs/${run.id}/reveal`)).json;
    expect(revealed.slots.every((s: any) => s.label)).toBe(true);
    st = (await api('GET', `/runs/${run.id}/stats`)).json;
    const best = st.slots.reduce((a: any, b: any) => (b.human_score > a.human_score ? b : a));
    expect(best.model).toBe('mock-strong');
  });

  it('comparative judging and strict per-case blinding', async () => {
    const ids = (await api('GET', '/models')).json.filter((m: any) => m.provider === 'mock').slice(0, 2).map((m: any) => m.id);
    const { json } = await api('POST', '/runs', { suite_id: 's_starter', model_ids: ids, blind_mode: 'per_case',
      judge: { enabled: true, model: 'mock-judge', mode: 'comparative' } });
    await waitForRun(json.id);
    const st = (await api('GET', `/runs/${json.id}/stats`)).json;
    expect(st.progress.ai_done).toBe(st.progress.ai_needed);
    expect(st.progress.ai_needed).toBeGreaterThan(0);
    const item = (await api('GET', `/runs/${json.id}/review`)).json.units[0].items[0];
    expect(item.slot).toBeNull();
    expect(item.display_label).toMatch(/^Response/);
  });

  it('records missing API keys as generation errors and can resume', async () => {
    const models = (await api('GET', '/models')).json;
    const claude = models.find((m: any) => m.provider === 'anthropic');
    const mock = models.find((m: any) => m.provider === 'mock');
    const { json } = await api('POST', '/runs', { suite_id: 's_starter', model_ids: [claude.id, mock.id], judge: { enabled: false } });
    await waitForRun(json.id);
    const st = (await api('GET', `/runs/${json.id}/stats`)).json;
    expect(st.slots.map((r: any) => r.errors).sort()).toEqual([0, 6]);
    expect((await api('POST', `/runs/${json.id}/resume`)).status).toBe(200);
    await waitForRun(json.id);
  });

  it('continues long jobs across invocations when the time budget runs out', async () => {
    process.env.JOB_BUDGET_MS = '150'; // each invocation does a little work, then re-enqueues itself
    const ids = (await api('GET', '/models')).json.filter((m: any) => m.provider === 'mock').map((m: any) => m.id);
    const { json } = await api('POST', '/runs', { suite_id: 's_starter', model_ids: ids, concurrency: 1,
      judge: { enabled: true, model: 'mock-judge' } });
    const run = await waitForRun(json.id);
    expect(run.judge_status).toBe('done');
    const st = (await api('GET', `/runs/${json.id}/stats`)).json;
    expect(st.progress.generations_done).toBe(18);
    expect(st.progress.ai_done).toBe(st.progress.ai_needed);
  }, 30_000);
});

describe('auth', () => {
  useFreshApp();

  it('requires the app password when set', async () => {
    delete process.env.ALLOW_NO_AUTH;
    expect((await api('GET', '/models')).status).toBe(503); // misconfigured: no password, not local
    process.env.APP_PASSWORD = 'hunter2';
    expect((await api('GET', '/models')).status).toBe(401);
    expect((await api('POST', '/login', { password: 'nope' })).status).toBe(401);
    const ok = await api('POST', '/login', { password: 'hunter2' });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')!.split(';')[0];
    expect((await api('GET', '/models', undefined, { cookie })).status).toBe(200);
    expect((await api('GET', '/models', undefined, { cookie: 'me_session=123.forged' })).status).toBe(401);
  });

  it('stores API keys encrypted', async () => {
    const r = await api('PUT', '/settings', { keys: { GEMINI_API_KEY: 'AIza-secret-1234' } });
    expect(r.json.keys.GEMINI_API_KEY).toMatchObject({ set: true, source: 'settings', preview: '…1234' });
    const db = await import('../server/db.ts');
    expect(await db.getSetting('key:GEMINI_API_KEY')).toMatch(/^enc:v1:/);
  });
});

describe('automatic checks', () => {
  it.each([
    [{ type: 'contains', value: 'foo' }, 'a FOO b', true],
    [{ type: 'contains', value: 'foo', case_sensitive: true }, 'a FOO b', false],
    [{ type: 'json_valid' }, '```json\n[1,2]\n```', true],
    [{ type: 'json_valid' }, '{nope', false],
    [{ type: 'max_words', value: '3' }, 'one two three four', false],
    [{ type: 'regex', value: '\\d{3}' }, 'abc 123', true],
    [{ type: 'regex', value: "\\A(?!\\s*(here'?s|sure)\\b)" }, "Here's the fix", false],
    [{ type: 'regex', value: "\\A(?!\\s*(here'?s|sure)\\b)" }, 'ok so the fix', true],
  ])('%o on %j → %s', (check, out, ok) => {
    expect(runCheck(check as any, out as string, null).passed).toBe(ok);
  });

  it('length ratio vs input', () => {
    const r = runCheck({ type: 'max_length_ratio', value: '0.5' }, 'a b c', null, 'a b c d e f g h');
    expect(r.passed).toBe(true);
    expect(r.check).toContain('0.38×');
  });
});
