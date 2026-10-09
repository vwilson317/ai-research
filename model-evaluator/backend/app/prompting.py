"""Assemble what each model (and the judge) sees: suite prompt, personal context and per-case documents."""

VOICE_INTRO = """Below are samples of the user's own words: transcripts of their voice notes and things they've written.
Study them to learn how they talk: vocabulary, rhythm, humour, sentence length, slang and recurring themes in their life.
When you rewrite or respond, sound like *them*, not like a generic assistant. Don't quote these samples unless it helps."""

BACKGROUND_INTRO = """Below is personal background about the user, from their own voice notes and writing.
Use it to make your response specific to them and their situation. Don't recite it back to them."""


def _fmt_date(iso: str | None) -> str:
    return (iso or "")[:10]


def context_block(run: dict, case: dict) -> str:
    """Suite-level personal context, newest first, within the character budget. Excludes this case's own source."""
    ctx = run["suite"].get("context") or {}
    docs = run.get("docs") or {}
    exclude = set(case.get("context_doc_ids") or []) | {case.get("source_doc_id")}
    chosen = [docs[i] for i in ctx.get("doc_ids", []) if i in docs and i not in exclude]
    if not chosen:
        return ""
    chosen.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    budget = ctx.get("max_chars", 24000)
    parts, used = [], 0
    for d in chosen:
        text = d["text"].strip()
        if used + len(text) > budget:
            text = text[: max(0, budget - used)]
        if not text:
            break
        parts.append(f'<sample title="{d["title"]}" date="{_fmt_date(d.get("created_at"))}">\n{text}\n</sample>')
        used += len(text)
    intro = VOICE_INTRO if ctx.get("role", "voice") == "voice" else BACKGROUND_INTRO
    tag = "user_voice_samples" if ctx.get("role", "voice") == "voice" else "user_background"
    return f"{intro}\n\n<{tag}>\n" + "\n".join(parts) + f"\n</{tag}>"


def system_prompt(run: dict, case: dict, model: dict | None = None) -> str | None:
    parts = [run["suite"].get("system_prompt"), context_block(run, case), (model or {}).get("system_prompt")]
    return "\n\n".join(p for p in parts if p) or None


def case_documents(run: dict, case: dict) -> str:
    docs = run.get("docs") or {}
    out = []
    for i in case.get("context_doc_ids") or []:
        d = docs.get(i)
        if d:
            label = "transcript" if d["kind"] in ("podcast", "voice_note") else "document"
            out.append(f'<{label} title="{d["title"]}">\n{d["text"]}\n</{label}>')
    return "\n\n".join(out)


def user_prompt(run: dict, case: dict) -> str:
    docs = case_documents(run, case)
    return f"{docs}\n\n{case['input']}" if docs else case["input"]
