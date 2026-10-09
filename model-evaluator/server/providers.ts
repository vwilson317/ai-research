/** Thin HTTP clients for each provider, normalised to a single `complete()` call. */
import { createHash } from 'node:crypto';
import * as db from './db.ts';
import { decrypt } from './auth.ts';
import { seededRandom, sleep } from './util.ts';

export const KEY_NAMES: Record<string, string> = {
  openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY', openai_compatible: 'OPENROUTER_API_KEY',
};
export const ALL_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'];

export class ProviderError extends Error {}
class Retryable extends Error {}

export interface Completion { text: string; input_tokens: number; output_tokens: number; finish_reason?: string }

/** Keys come from the (encrypted) settings table first, then environment variables. */
export async function resolveKey(name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const stored = await db.getSetting(`key:${name}`);
  let val = (stored && decrypt(stored)) || process.env[name] || null;
  if (!val && name === 'GEMINI_API_KEY') val = process.env.GOOGLE_API_KEY || null;
  return val;
}

export const keyFor = (provider: string, override?: string | null) => resolveKey(override || KEY_NAMES[provider]);

export interface CompleteArgs {
  provider: string; model: string; prompt: string; system?: string | null; temperature?: number | null;
  max_tokens?: number; top_p?: number | null; json_mode?: boolean; base_url?: string | null; api_key?: string | null;
}

export async function complete(a: CompleteArgs): Promise<Completion> {
  if (a.provider === 'mock') return mock(a.model, a.prompt, a.system);
  if (a.provider !== 'openai_compatible' && !a.api_key)
    throw new ProviderError(`No API key configured for provider '${a.provider}'. Add it on the API keys page or as a Netlify environment variable.`);
  for (let attempt = 0; ; attempt++) {
    try {
      switch (a.provider) {
        case 'openai': return await openai('https://api.openai.com/v1', a, true);
        case 'openai_compatible':
          if (!a.base_url) throw new ProviderError('openai_compatible models need a base_url');
          return await openai(a.base_url.replace(/\/+$/, ''), a, false);
        case 'anthropic': return await anthropic(a);
        case 'google': return await google(a);
        default: throw new ProviderError(`Unknown provider ${a.provider}`);
      }
    } catch (e) {
      if (!(e instanceof Retryable)) throw e;
      if (attempt >= 3) throw new ProviderError(e.message);
      await sleep(1000 * 2 ** attempt + Math.random() * 1000);
    }
  }
}

async function post(url: string, body: unknown, headers: Record<string, string>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000) });
  } catch (e) {
    throw new Retryable(`network error: ${(e as Error).message}`);
  }
  const text = await res.text();
  if ([429, 500, 502, 503, 504, 529].includes(res.status)) throw new Retryable(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (res.status >= 400) throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function openai(base: string, a: CompleteArgs, official: boolean): Promise<Completion> {
  const messages = [...(a.system ? [{ role: 'system', content: a.system }] : []), { role: 'user', content: a.prompt }];
  const body: Record<string, unknown> = { model: a.model, messages };
  body[official ? 'max_completion_tokens' : 'max_tokens'] = a.max_tokens ?? 2048;
  if (a.temperature != null) body.temperature = a.temperature;
  if (a.top_p != null) body.top_p = a.top_p;
  if (a.json_mode) body.response_format = { type: 'json_object' };
  const data = await post(`${base}/chat/completions`, body, a.api_key ? { authorization: `Bearer ${a.api_key}` } : {});
  const choice = data.choices?.[0] ?? {};
  return { text: choice.message?.content ?? '', input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0, finish_reason: choice.finish_reason };
}

async function anthropic(a: CompleteArgs): Promise<Completion> {
  const body: Record<string, unknown> = { model: a.model, max_tokens: a.max_tokens ?? 2048, messages: [{ role: 'user', content: a.prompt }] };
  if (a.system) body.system = a.system;
  if (a.temperature != null) body.temperature = a.temperature;
  else if (a.top_p != null) body.top_p = a.top_p;
  const data = await post('https://api.anthropic.com/v1/messages', body, { 'x-api-key': a.api_key!, 'anthropic-version': '2023-06-01' });
  const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return { text, input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0, finish_reason: data.stop_reason };
}

export const GEMINI = 'https://generativelanguage.googleapis.com';

export function geminiText(data: any): { text: string; finish?: string } {
  const cand = data.candidates?.[0];
  if (!cand) throw new ProviderError(`Gemini returned no candidates: ${JSON.stringify(data.promptFeedback ?? {}).slice(0, 300)}`);
  const text = (cand.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('');
  return { text, finish: cand.finishReason };
}

async function google(a: CompleteArgs): Promise<Completion> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: a.max_tokens ?? 2048 };
  if (a.temperature != null) generationConfig.temperature = a.temperature;
  if (a.top_p != null) generationConfig.topP = a.top_p;
  if (a.json_mode) generationConfig.responseMimeType = 'application/json';
  const body: Record<string, unknown> = { contents: [{ role: 'user', parts: [{ text: a.prompt }] }], generationConfig };
  if (a.system) body.systemInstruction = { parts: [{ text: a.system }] };
  const data = await post(`${GEMINI}/v1beta/models/${a.model}:generateContent`, body, { 'x-goog-api-key': a.api_key! });
  const { text, finish } = geminiText(data);
  const u = data.usageMetadata ?? {};
  return { text, input_tokens: u.promptTokenCount ?? 0, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), finish_reason: finish };
}

// ---- mock provider: try the whole flow offline ----

async function mock(model: string, prompt: string, system?: string | null): Promise<Completion> {
  const seed = createHash('sha256').update(`${model}|${prompt}`).digest('hex').slice(0, 8);
  const rand = seededRandom(seed);
  await sleep(20 + rand() * 120);
  const quality = ({ 'mock-strong': 0.9, 'mock-average': 0.6, 'mock-weak': 0.3 } as Record<string, number>)[model] ?? 0.5;
  const snippet = prompt.trim().split('\n')[0]?.slice(0, 120) ?? '';
  const text = rand() < quality
    ? `Here is a careful answer to: "${snippet}".\n\n1. Restate the problem.\n2. Work through it step by step.\n3. Give a clear final answer.\n\n(mock model ${model}, quality ${quality})`
    : `Not sure. Maybe something about ${snippet.slice(0, 40)}? (mock model ${model})`;
  return { text, input_tokens: Math.floor(prompt.length / 4) + Math.floor((system ?? '').length / 4), output_tokens: Math.floor(text.length / 4) };
}
