"""Request/response shape for each real provider, against a mocked HTTP transport."""
import asyncio
import json

import httpx
import pytest

from app import providers


@pytest.fixture()
def capture(monkeypatch):
    seen = {}
    responses = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=responses["body"])

    real = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return seen, responses


def run(coro):
    return asyncio.run(coro)


def test_gemini(capture):
    seen, resp = capture
    resp["body"] = {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True}, {"text": '{"a": 1}'}]}}],
                    "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "thoughtsTokenCount": 7}}
    out = run(providers.complete(provider="google", model="gemini-3.8-flash", prompt="hi", system="sys",
                                 temperature=0.0, max_tokens=100, json_mode=True, api_key="k"))
    assert seen["url"].endswith("/v1beta/models/gemini-3.8-flash:generateContent")
    assert seen["headers"]["x-goog-api-key"] == "k"
    assert seen["body"]["systemInstruction"] == {"parts": [{"text": "sys"}]}
    assert seen["body"]["generationConfig"]["responseMimeType"] == "application/json"
    assert out.text == '{"a": 1}' and out.input_tokens == 10 and out.output_tokens == 12


def test_anthropic(capture):
    seen, resp = capture
    resp["body"] = {"content": [{"type": "text", "text": "hello"}], "usage": {"input_tokens": 3, "output_tokens": 2}}
    out = run(providers.complete(provider="anthropic", model="claude-sonnet-5-5", prompt="hi", system="sys",
                                 temperature=0.5, max_tokens=50, api_key="k"))
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["headers"]["x-api-key"] == "k" and seen["headers"]["anthropic-version"]
    assert seen["body"]["system"] == "sys" and seen["body"]["max_tokens"] == 50
    assert out.text == "hello" and out.output_tokens == 2


def test_openai_compatible(capture):
    seen, resp = capture
    resp["body"] = {"choices": [{"message": {"content": "yo"}}], "usage": {"prompt_tokens": 4, "completion_tokens": 1}}
    out = run(providers.complete(provider="openai_compatible", model="llama", prompt="hi", temperature=None,
                                 max_tokens=10, base_url="http://localhost:11434/v1/", api_key=None))
    assert seen["url"] == "http://localhost:11434/v1/chat/completions"
    assert "temperature" not in seen["body"] and seen["body"]["max_tokens"] == 10
    assert "authorization" not in seen["headers"]
    assert out.text == "yo"


def test_missing_key_errors():
    with pytest.raises(providers.ProviderError, match="No API key"):
        run(providers.complete(provider="google", model="x", prompt="hi", api_key=None))
