import type { JudgeConfig, ModelConfig, ReviewUnit, Run, RunListItem, Settings, Stats, Suite } from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json();
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  settings: () => req<Settings>('/settings'),
  saveKeys: (keys: Record<string, string | null>) => req<Settings>('/settings', json('PUT', { keys })),

  models: () => req<ModelConfig[]>('/models'),
  createModel: (m: ModelConfig) => req<ModelConfig>('/models', json('POST', m)),
  updateModel: (id: string, m: ModelConfig) => req<ModelConfig>(`/models/${id}`, json('PUT', m)),
  deleteModel: (id: string) => req(`/models/${id}`, json('DELETE')),
  testModel: (id: string) => req<{ ok: boolean; output?: string; error?: string }>(`/models/${id}/test`, json('POST')),

  suites: () => req<Suite[]>('/suites'),
  suite: (id: string) => req<Suite>(`/suites/${id}`),
  createSuite: (s: Suite) => req<Suite>('/suites', json('POST', s)),
  updateSuite: (id: string, s: Suite) => req<Suite>(`/suites/${id}`, json('PUT', s)),
  deleteSuite: (id: string) => req(`/suites/${id}`, json('DELETE')),

  runs: () => req<RunListItem[]>('/runs'),
  run: (id: string) => req<Run>(`/runs/${id}`),
  createRun: (body: {
    name?: string; suite_id: string; model_ids: string[]; samples_per_case: number;
    concurrency: number; blind_mode: string; judge: JudgeConfig;
  }) => req<Run>('/runs', json('POST', body)),
  deleteRun: (id: string) => req(`/runs/${id}`, json('DELETE')),
  resumeRun: (id: string) => req(`/runs/${id}/resume`, json('POST')),
  judgeRun: (id: string, cfg?: JudgeConfig) => req(`/runs/${id}/judge`, json('POST', cfg ?? null)),
  metaReview: (id: string) => req(`/runs/${id}/meta-review`, json('POST')),
  reveal: (id: string) => req<Run>(`/runs/${id}/reveal`, json('POST')),
  hide: (id: string) => req<Run>(`/runs/${id}/hide`, json('POST')),
  review: (id: string, includeAi: boolean) => req<{ units: ReviewUnit[] }>(`/runs/${id}/review?include_ai=${includeAi}`),
  saveScores: (id: string, scores: { generation_id: string; criterion_id: string; score: number; note?: string | null }[]) =>
    req(`/runs/${id}/scores`, json('POST', { scores })),
  stats: (id: string) => req<Stats>(`/runs/${id}/stats`),
  exportUrl: (id: string) => `/api/runs/${id}/export`,
};
