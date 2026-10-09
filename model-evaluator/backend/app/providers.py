"""Thin HTTP clients for each provider, normalised to a single `complete()` call."""
import asyncio
import hashlib
import os
import random
from dataclasses import dataclass

import httpx

from . import db

# Well-known key names; values come from the local settings table first, then the environment.
KEY_NAMES = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GEMINI_API_KEY",
    "openai_compatible": "OPENROUTER_API_KEY",
}
ALL_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]

TIMEOUT = httpx.Timeout(180.0, connect=15.0)


class ProviderError(RuntimeError):
    pass


@dataclass
class Completion:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0


def resolve_key(name: str | None) -> str | None:
    if not name:
        return None
    val = db.get_setting(name) or os.environ.get(name)
    if not val and name == "GEMINI_API_KEY":
        val = db.get_setting("GOOGLE_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    return val


def key_for(provider: str, override: str | None = None) -> str | None:
    return resolve_key(override) if override else resolve_key(KEY_NAMES.get(provider))


async def complete(
    *,
    provider: str,
    model: str,
    prompt: str,
    system: str | None = None,
    temperature: float | None = None,
    max_tokens: int = 2048,
    top_p: float | None = None,
    json_mode: bool = False,
    base_url: str | None = None,
    api_key: str | None = None,
) -> Completion:
    if provider == "mock":
        return await _mock(model, prompt, system)
    if provider != "openai_compatible" and not api_key:
        raise ProviderError(f"No API key configured for provider '{provider}'. Add it in Settings or the environment.")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for attempt in range(4):
            try:
                if provider == "openai":
                    return await _openai(client, "https://api.openai.com/v1", model, prompt, system, temperature,
                                         max_tokens, top_p, json_mode, api_key, official=True)
                if provider == "openai_compatible":
                    if not base_url:
                        raise ProviderError("openai_compatible models need a base_url")
                    return await _openai(client, base_url.rstrip("/"), model, prompt, system, temperature,
                                         max_tokens, top_p, json_mode, api_key, official=False)
                if provider == "anthropic":
                    return await _anthropic(client, model, prompt, system, temperature, max_tokens, top_p, api_key)
                if provider == "google":
                    return await _google(client, model, prompt, system, temperature, max_tokens, top_p, json_mode, api_key)
                raise ProviderError(f"Unknown provider {provider}")
            except _Retryable as e:
                if attempt == 3:
                    raise ProviderError(str(e)) from None
                await asyncio.sleep(2 ** attempt + random.random())
    raise ProviderError("unreachable")


class _Retryable(Exception):
    pass


def _check(resp: httpx.Response) -> dict:
    if resp.status_code in (429, 500, 502, 503, 504, 529):
        raise _Retryable(f"HTTP {resp.status_code}: {resp.text[:300]}")
    if resp.status_code >= 400:
        raise ProviderError(f"HTTP {resp.status_code}: {resp.text[:500]}")
    return resp.json()


async def _openai(client, base, model, prompt, system, temperature, max_tokens, top_p, json_mode, api_key, official):
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    body: dict = {"model": model, "messages": messages}
    body["max_completion_tokens" if official else "max_tokens"] = max_tokens
    if temperature is not None:
        body["temperature"] = temperature
    if top_p is not None:
        body["top_p"] = top_p
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    data = _check(await client.post(f"{base}/chat/completions", json=body, headers=headers))
    choice = (data.get("choices") or [{}])[0]
    text = (choice.get("message") or {}).get("content") or ""
    usage = data.get("usage") or {}
    return Completion(text, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))


async def _anthropic(client, model, prompt, system, temperature, max_tokens, top_p, api_key):
    body: dict = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = temperature
    elif top_p is not None:
        body["top_p"] = top_p
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    data = _check(await client.post("https://api.anthropic.com/v1/messages", json=body, headers=headers))
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage") or {}
    return Completion(text, usage.get("input_tokens", 0), usage.get("output_tokens", 0))


async def _google(client, model, prompt, system, temperature, max_tokens, top_p, json_mode, api_key):
    gen_cfg: dict = {"maxOutputTokens": max_tokens}
    if temperature is not None:
        gen_cfg["temperature"] = temperature
    if top_p is not None:
        gen_cfg["topP"] = top_p
    if json_mode:
        gen_cfg["responseMimeType"] = "application/json"
    body: dict = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": gen_cfg}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    data = _check(await client.post(url, json=body, headers={"x-goog-api-key": api_key}))
    cands = data.get("candidates") or []
    if not cands:
        raise ProviderError(f"Gemini returned no candidates: {str(data.get('promptFeedback'))[:300]}")
    parts = (cands[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    usage = data.get("usageMetadata") or {}
    out = usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
    return Completion(text, usage.get("promptTokenCount", 0), out)


# ---- mock provider: lets you try the whole flow without spending tokens ----

async def _mock(model: str, prompt: str, system: str | None) -> Completion:
    seed = int(hashlib.sha256(f"{model}|{prompt}".encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    await asyncio.sleep(0.05 + rng.random() * 0.3)
    quality = {"mock-strong": 0.9, "mock-average": 0.6, "mock-weak": 0.3}.get(model, 0.5)
    snippet = prompt.strip().splitlines()[0][:120] if prompt.strip() else ""
    if rng.random() < quality:
        text = (f"Here is a careful answer to: \"{snippet}\".\n\n"
                "1. Restate the problem.\n2. Work through it step by step.\n3. Give a clear final answer.\n\n"
                f"(mock model {model}, quality {quality})")
    else:
        text = f"Not sure. Maybe something about {snippet[:40]}? (mock model {model})"
    return Completion(text, len(prompt) // 4 + (len(system or "") // 4), len(text) // 4)
