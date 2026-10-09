import { describe, expect, it } from 'vitest';
import { complete, ProviderError } from '../server/providers.ts';
import { stubFetch, useFreshApp } from './helpers.ts';

describe('provider request/response shapes', () => {
  useFreshApp();

  function capture(responseBody: unknown) {
    const seen: { url?: string; headers?: Record<string, string>; body?: any } = {};
    stubFetch((url, init) => {
      Object.assign(seen, { url, headers: init.headers, body: JSON.parse(init.bodyText ?? '{}') });
      return new Response(JSON.stringify(responseBody), { status: 200 });
    });
    return seen;
  }

  it('gemini', async () => {
    const seen = capture({ candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"a": 1}' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } });
    const out = await complete({ provider: 'google', model: 'gemini-3.8-flash', prompt: 'hi', system: 'sys', temperature: 0, max_tokens: 100, json_mode: true, api_key: 'k' });
    expect(seen.url).toMatch(/\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
    expect(seen.headers!['x-goog-api-key']).toBe('k');
    expect(seen.body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(seen.body.generationConfig.responseMimeType).toBe('application/json');
    expect(out).toMatchObject({ text: '{"a": 1}', input_tokens: 10, output_tokens: 12 });
  });

  it('anthropic', async () => {
    const seen = capture({ content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 3, output_tokens: 2 } });
    const out = await complete({ provider: 'anthropic', model: 'claude-sonnet-5-5', prompt: 'hi', system: 'sys', temperature: 0.5, max_tokens: 50, api_key: 'k' });
    expect(seen.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen.headers!['x-api-key']).toBe('k');
    expect(seen.body).toMatchObject({ system: 'sys', max_tokens: 50 });
    expect(out).toMatchObject({ text: 'hello', output_tokens: 2 });
  });

  it('openai-compatible without a key', async () => {
    const seen = capture({ choices: [{ message: { content: 'yo' } }], usage: { prompt_tokens: 4, completion_tokens: 1 } });
    const out = await complete({ provider: 'openai_compatible', model: 'llama', prompt: 'hi', temperature: null, max_tokens: 10, base_url: 'http://localhost:11434/v1/' });
    expect(seen.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(seen.body.temperature).toBeUndefined();
    expect(seen.body.max_tokens).toBe(10);
    expect(seen.headers!.authorization).toBeUndefined();
    expect(out.text).toBe('yo');
  });

  it('missing key is a clear error', async () => {
    await expect(complete({ provider: 'google', model: 'x', prompt: 'hi', api_key: null })).rejects.toThrow(ProviderError);
  });
});
