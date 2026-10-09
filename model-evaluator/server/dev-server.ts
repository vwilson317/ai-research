/**
 * Local development without a Netlify account: Vite (UI) + the same API handler, jobs run in-process,
 * data in an embedded Postgres under .data/. `npm run dev` → http://localhost:8888
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createVite } from 'vite';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.JOB_MODE ??= 'inline';
if (!process.env.APP_PASSWORD) process.env.ALLOW_NO_AUTH ??= '1';

const { handle } = await import('./api.ts');
const vite = await createVite({ server: { middlewareMode: true }, appType: 'spa' });
const port = Number(process.env.PORT ?? 8888);

createServer(async (req, res) => {
  if (!req.url?.startsWith('/api/')) return vite.middlewares(req, res);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method, headers: req.headers as Record<string, string>,
    body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
  });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`Model Evaluator → http://localhost:${port}${process.env.APP_PASSWORD ? '' : ' (no password: local only)'}`));
