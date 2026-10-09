/**
 * Background jobs. On Netlify each job runs in the `worker-background` function (15-minute limit);
 * long jobs stop at a time budget and re-enqueue themselves to continue in a fresh invocation.
 * Locally (JOB_MODE=inline) jobs run in-process.
 */
import { workerToken } from './auth.ts';
import * as runner from './runner.ts';
import * as podcasts from './podcasts.ts';

export type Job =
  | { type: 'generate'; runId: string }
  | { type: 'judge'; runId: string; attempted: string[] }
  | { type: 'meta'; runId: string }
  | { type: 'podcast'; docId: string; feedUrl: string; guid: string; mode: 'auto' | 'feed' | 'transcribe' }
  | { type: 'style_guide'; docId: string; sourceIds: string[]; model: string };

const inflight = new Set<Promise<unknown>>();

const budgetMs = () => Number(process.env.JOB_BUDGET_MS ?? (process.env.JOB_MODE === 'inline' ? 1e12 : 12 * 60_000));

export async function enqueue(job: Job, origin: string): Promise<void> {
  if (process.env.JOB_MODE === 'inline') {
    const p = runJob(job, origin).catch((e) => console.error('job failed', job.type, e));
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return;
  }
  const res = await fetch(`${origin}/.netlify/functions/worker-background`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-token': workerToken() }, body: JSON.stringify(job),
  });
  if (!res.ok) throw new Error(`Could not start background job (${res.status})`);
}

export async function runJob(job: Job, origin: string): Promise<void> {
  const deadline = Date.now() + budgetMs();
  let next: Job | null = null;
  switch (job.type) {
    case 'generate': next = await runner.generate(job.runId, deadline); break;
    case 'judge': next = await runner.judge(job.runId, job.attempted, deadline); break;
    case 'meta': await runner.metaReview(job.runId); break;
    case 'podcast': await podcasts.importEpisode(job.docId, job.feedUrl, job.guid, job.mode); break;
    case 'style_guide': await runner.styleGuide(job.docId, job.sourceIds, job.model); break;
  }
  if (next) await enqueue(next, origin);
}

/** Tests: wait until every in-process job (and its continuations) has finished. */
export async function idle() {
  while (inflight.size) await Promise.all([...inflight]);
}
