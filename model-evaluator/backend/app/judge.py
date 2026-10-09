"""AI judge (Gemini by default): scores outputs blind, and reviews the eval itself."""
import hashlib
import json
import random
import re

from . import prompting, providers
from .providers import ProviderError

JUDGE_SYSTEM = """You are a meticulous, impartial evaluator of AI model responses.
- You do NOT know which model wrote any response; never guess or mention model identities.
- Grade strictly against the criteria and rubric provided. Use the full scale.
- Do not reward length, confidence or formatting for its own sake.
- If a reference answer is given, use it as the gold standard for correctness, but accept equivalent answers.
- Keep each rationale to 1-3 sentences citing concrete evidence from the response.
- Respond with JSON only, exactly matching the requested schema."""


def scale_text(scale_max: int) -> str:
    return "0 (fail) or 1 (pass)" if scale_max == 1 else f"integer 1 to {scale_max} ({scale_max} = best)"


def criteria_block(criteria: list[dict]) -> str:
    lines = []
    for c in criteria:
        lines.append(f'- id: "{c["id"]}"\n  name: {c["name"]}\n  scale: {scale_text(c["scale_max"])}')
        if c.get("description"):
            lines.append(f"  description: {c['description']}")
        if c.get("rubric"):
            lines.append("  rubric: " + c["rubric"].replace("\n", "\n    "))
    return "\n".join(lines)


def _task_block(run: dict, case: dict, include_reference: bool) -> str:
    suite = run["suite"]
    parts = []
    if suite.get("system_prompt"):
        parts.append(f"<system_prompt_given_to_model>\n{suite['system_prompt']}\n</system_prompt_given_to_model>")
    if (suite.get("context") or {}).get("share_with_judge", True):
        ctx = prompting.context_block(run, case)
        if ctx:
            parts.append("The model was given this personal context about the user. Use it to judge voice/tone match "
                         f"and personalisation.\n<personal_context>\n{ctx}\n</personal_context>")
    docs = prompting.case_documents(run, case)
    if docs:
        parts.append(f"<source_material_given_to_model>\n{docs}\n</source_material_given_to_model>")
    parts.append(f"<task>\n{case['input']}\n</task>")
    if include_reference and case.get("reference"):
        parts.append(f"<reference_answer>\n{case['reference']}\n</reference_answer>")
    return "\n\n".join(parts)


def build_individual_prompt(run: dict, case: dict, criteria: list[dict], output: str, include_reference: bool) -> str:
    return f"""{_task_block(run, case, include_reference)}

<response>
{output}
</response>

Criteria:
{criteria_block(criteria)}

Return JSON: {{"scores": [{{"criterion_id": "<id>", "score": <number>, "rationale": "<why>"}}, ...]}}
Include every criterion id exactly once."""


def build_comparative_prompt(run: dict, case: dict, criteria: list[dict], labelled: list[tuple[str, str]],
                             include_reference: bool) -> str:
    responses = "\n\n".join(f'<response label="{label}">\n{text}\n</response>' for label, text in labelled)
    return f"""{_task_block(run, case, include_reference)}

Several anonymous responses to the same task follow, in random order. Grade each one on its own merits
against the criteria, but use the comparison to calibrate your scores consistently.

{responses}

Criteria:
{criteria_block(criteria)}

Return JSON: {{"evaluations": [{{"label": "<response label>", "scores": [{{"criterion_id": "<id>", "score": <number>, "rationale": "<why>"}}]}}]}}
Include every response label and every criterion id."""


def parse_json(text: str) -> dict:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if m:
        text = m.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise ProviderError(f"Judge did not return JSON: {text[:200]}")


def clamp(score, scale_max: int) -> float:
    try:
        s = float(score)
    except (TypeError, ValueError):
        raise ProviderError(f"Non-numeric score {score!r}")
    lo = 0 if scale_max == 1 else 1
    return max(lo, min(scale_max, round(s)))


async def call_judge(cfg: dict, prompt: str, system: str = JUDGE_SYSTEM) -> tuple[dict, providers.Completion]:
    model = cfg["model"]
    if model.startswith("mock"):
        comp = _mock_judge(prompt)
    else:
        comp = await providers.complete(
            provider="google", model=model, prompt=prompt, system=system,
            temperature=cfg.get("temperature", 0.0), max_tokens=8192, json_mode=True,
            api_key=providers.key_for("google"),
        )
    return parse_json(comp.text), comp


def _mock_judge(prompt: str) -> providers.Completion:
    """Deterministic fake judge used for tests and offline demos."""
    rng = random.Random(int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16))
    crit = re.findall(r'- id: "([^"]+)"\n  name: .*\n  scale: (0 \(fail\)|integer 1 to (\d+))', prompt)

    def score_for(text: str) -> list[dict]:
        good = "careful answer" in text
        out = []
        for cid, kind, mx in crit:
            if kind.startswith("0"):
                s = 1 if good or rng.random() < 0.2 else 0
            else:
                m = int(mx)
                s = max(1, min(m, (m - rng.randint(0, 1)) if good else rng.randint(1, max(1, m // 2))))
            out.append({"criterion_id": cid, "score": s, "rationale": "mock judge rationale"})
        return out

    if "<review_request>" in prompt:
        body = {"overall_quality": 6, "summary": "Mock review of the eval.", "strengths": ["Clear criteria"],
                "issues": [{"severity": "medium", "title": "Few cases", "detail": "Add more cases."}],
                "non_discriminative_cases": [], "criteria_feedback": [], "suggested_cases": [],
                "judge_reliability": "Mock.", "recommendations": ["Add harder cases."]}
    elif '<response label="' in prompt:
        labels = re.findall(r'<response label="([^"]+)">\n(.*?)\n</response>', prompt, re.S)
        body = {"evaluations": [{"label": l, "scores": score_for(t)} for l, t in labels]}
    else:
        resp = re.search(r"<response>\n(.*?)\n</response>", prompt, re.S)
        body = {"scores": score_for(resp.group(1) if resp else "")}
    text = json.dumps(body)
    return providers.Completion(text, len(prompt) // 4, len(text) // 4)


# ---- meta-review: the AI evaluates the evaluation ----

META_SYSTEM = """You are an expert in LLM evaluation methodology. You audit evaluation suites and their results
to judge whether the eval is actually measuring what it claims, and how to make it better. Be concrete and critical.
Model identities are hidden from you on purpose; refer to models only by their anonymous labels. Respond with JSON only."""


def build_meta_prompt(suite: dict, stats: dict, disagreements: list[dict], examples: list[dict]) -> str:
    suite_view = {
        "name": suite["name"], "description": suite.get("description", ""),
        "system_prompt": suite.get("system_prompt", ""),
        "criteria": suite.get("criteria", []), "global_checks": suite.get("global_checks", []),
        "cases": [{k: c.get(k) for k in ("id", "input", "reference", "tags", "checks")} for c in suite.get("cases", [])],
    }
    return f"""<review_request>
Audit this evaluation. Assess: are the test cases representative, varied and hard enough to separate models?
Are criteria well-defined, non-overlapping, and gradable? Are the rubrics/scales calibrated? Do human and AI-judge
scores agree, and where they don't, which looks more right and why? Are there signs of bias (length, position,
formatting)? Which cases fail to discriminate between models? What should be added or changed?
</review_request>

<eval_suite>
{json.dumps(suite_view, indent=2)[:30000]}
</eval_suite>

<aggregate_results>
{json.dumps(stats, indent=2)[:20000]}
</aggregate_results>

<largest_human_vs_ai_disagreements>
{json.dumps(disagreements, indent=2)[:12000]}
</largest_human_vs_ai_disagreements>

<sample_outputs>
{json.dumps(examples, indent=2)[:15000]}
</sample_outputs>

Return JSON with this shape:
{{
  "overall_quality": <integer 1-10 rating of the eval's design and reliability>,
  "summary": "<3-5 sentence verdict>",
  "strengths": ["..."],
  "issues": [{{"severity": "high|medium|low", "title": "...", "detail": "..."}}],
  "non_discriminative_cases": [{{"case_id": "...", "why": "..."}}],
  "criteria_feedback": [{{"criterion_id": "...", "feedback": "...", "suggested_rubric": "..."}}],
  "suggested_cases": [{{"input": "...", "reference": "...", "why": "..."}}],
  "judge_reliability": "<assessment of human vs AI-judge agreement and what it implies>",
  "recommendations": ["..."]
}}"""
