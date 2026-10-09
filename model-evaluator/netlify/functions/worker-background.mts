// Background function (15-minute limit): runs eval generation, judging, podcast transcription and style guides.
import { isWorker } from '../../server/auth.ts';
import { runJob, type Job } from '../../server/jobs.ts';

export default async (req: Request) => {
  if (req.method !== 'POST' || !isWorker(req)) return;
  const job = (await req.json()) as Job;
  await runJob(job, new URL(req.url).origin);
};
