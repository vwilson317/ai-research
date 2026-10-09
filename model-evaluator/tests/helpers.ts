import { afterEach, beforeEach, vi } from 'vitest';
import * as db from '../server/db.ts';
import * as seed from '../server/seed.ts';
import * as jobs from '../server/jobs.ts';
import { handle } from '../server/api.ts';

export function useFreshApp() {
  beforeEach(() => {
    process.env.EVAL_DATA_DIR = 'memory';
    process.env.JOB_MODE = 'inline';
    process.env.ALLOW_NO_AUTH = '1';
    delete process.env.APP_PASSWORD;
    delete process.env.JOB_BUDGET_MS;
    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
    db.resetForTests();
    seed.resetForTests();
  });
  afterEach(async () => {
    await jobs.idle();
    vi.unstubAllGlobals();
  });
}

export async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await handle(new Request(`http://localhost/api${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

export async function waitForRun(id: string, pred: (r: any) => boolean = (r) => r.status === 'ready' && !r.busy) {
  await jobs.idle();
  const r = (await api('GET', `/runs/${id}`)).json;
  if (!pred(r)) throw new Error(`run not in expected state: ${JSON.stringify({ status: r.status, judge: r.judge_status, errs: r.judge_errors })}`);
  return r;
}

/** Route fetch() calls to a handler; anything unhandled returns 404. */
export function stubFetch(handler: (url: string, init: RequestInit & { bodyText?: string }) => Response | Promise<Response> | undefined) {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ method: init.method ?? 'GET', url });
    const bodyText = typeof init.body === 'string' ? init.body : undefined;
    return (await handler(url, { ...init, bodyText })) ?? new Response('not found', { status: 404 });
  });
  return calls;
}
