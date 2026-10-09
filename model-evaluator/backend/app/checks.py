"""Deterministic, automatic checks run against every model output."""
import json
import re

from .schemas import AutoCheck


def _norm(s: str, case_sensitive: bool) -> str:
    s = s.strip()
    return s if case_sensitive else s.lower()


def _strip_fences(text: str) -> str:
    m = re.match(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", text, re.S)
    return m.group(1) if m else text


def run_check(check: AutoCheck, output: str, reference: str | None, input_text: str = "") -> dict:
    v = check.value or ""
    cs = check.case_sensitive
    words = len(output.split())
    try:
        match check.type:
            case "contains":
                ok = _norm(v, cs) in _norm(output, cs)
            case "not_contains":
                ok = _norm(v, cs) not in _norm(output, cs)
            case "exact":
                ok = _norm(output, cs) == _norm(v, cs)
            case "starts_with":
                ok = _norm(output, cs).startswith(_norm(v, cs))
            case "regex":
                ok = re.search(v, output, 0 if cs else re.I) is not None
            case "json_valid":
                json.loads(_strip_fences(output))
                ok = True
            case "min_words":
                ok = words >= int(v)
            case "max_words":
                ok = words <= int(v)
            case "max_chars":
                ok = len(output) <= int(v)
            case "max_length_ratio":
                ok = words <= float(v) * max(1, len(input_text.split()))
            case "min_length_ratio":
                ok = words >= float(v) * max(1, len(input_text.split()))
            case "matches_reference":
                ok = bool(reference) and _norm(reference, cs) in _norm(output, cs)
            case _:
                ok = False
        detail = ""
    except json.JSONDecodeError as e:
        ok, detail = False, f"invalid JSON: {e.msg}"
    except (ValueError, re.error) as e:
        ok, detail = False, f"check error: {e}"
    if check.type in ("max_length_ratio", "min_length_ratio"):
        ratio = words / max(1, len(input_text.split()))
        label = f"{'≤' if check.type.startswith('max') else '≥'}{v}× input length (got {ratio:.2f}×)"
        return {"check": label, "passed": ok, "detail": detail}
    label = f"{check.type}" + (f" '{v}'" if v and check.type not in ("json_valid", "matches_reference") else "")
    return {"check": label, "passed": ok, "detail": detail}


def run_checks(checks: list[AutoCheck], output: str, reference: str | None, input_text: str = "") -> list[dict]:
    return [run_check(c, output, reference, input_text) for c in checks]
