"""Starter data so the app is usable on first launch."""
from . import db

STARTER_MODELS = [
    {"id": "m_mock_strong", "label": "Mock Strong (offline)", "provider": "mock", "model": "mock-strong"},
    {"id": "m_mock_average", "label": "Mock Average (offline)", "provider": "mock", "model": "mock-average"},
    {"id": "m_mock_weak", "label": "Mock Weak (offline)", "provider": "mock", "model": "mock-weak"},
    {"id": "m_gemini_flash", "label": "Gemini 3.8 Flash", "provider": "google", "model": "gemini-3.8-flash",
     "price_input_per_mtok": 0.0, "price_output_per_mtok": 0.0},
    {"id": "m_claude_sonnet", "label": "Claude Sonnet 5.5", "provider": "anthropic", "model": "claude-sonnet-5-5"},
]

STARTER_SUITE = {
    "id": "s_starter",
    "name": "General assistant starter",
    "description": "A small mixed suite: reasoning, coding, summarisation, structured output and factual accuracy. "
                   "Duplicate it and make it your own.",
    "system_prompt": "You are a helpful assistant. Answer accurately and concisely.",
    "criteria": [
        {"id": "correctness", "name": "Correctness", "description": "Is the answer factually and logically correct?",
         "rubric": "5: fully correct\n4: correct with minor slips\n3: partially correct\n2: mostly wrong\n1: wrong or missing",
         "scale_max": 5, "weight": 2.0, "graded_by": "both"},
        {"id": "helpfulness", "name": "Helpfulness", "description": "Does it actually solve the user's need?",
         "rubric": "5: fully addresses the need, anticipates follow-ups\n3: adequate\n1: unhelpful",
         "scale_max": 5, "weight": 1.0, "graded_by": "both"},
        {"id": "clarity", "name": "Clarity & concision", "description": "Well organised, no padding.",
         "rubric": "5: crisp and well structured\n3: understandable but wordy or messy\n1: confusing",
         "scale_max": 5, "weight": 1.0, "graded_by": "both"},
        {"id": "instructions", "name": "Follows instructions",
         "description": "Respects every explicit constraint (format, length, language).",
         "rubric": "1 = all explicit constraints satisfied, 0 = any violated", "scale_max": 1, "weight": 1.0,
         "graded_by": "both"},
    ],
    "global_checks": [],
    "cases": [
        {"id": "c1", "tags": ["reasoning"],
         "input": "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Give the final answer on its own line.",
         "reference": "$0.05 (5 cents)", "checks": [{"type": "regex", "value": r"0?\.05|5 cents|five cents"}]},
        {"id": "c2", "tags": ["coding"],
         "input": "Write a Python function `is_palindrome(s: str) -> bool` that ignores case and non-alphanumeric characters. Include two doctest examples.",
         "reference": "Filters with str.isalnum, lowercases, compares to its reverse; doctests e.g. 'A man, a plan, a canal: Panama' -> True, 'hello' -> False.",
         "checks": [{"type": "contains", "value": "def is_palindrome"}, {"type": "contains", "value": ">>>"}]},
        {"id": "c3", "tags": ["summarisation"],
         "input": "Summarise in exactly 2 sentences: The James Webb Space Telescope launched on 25 December 2021. It observes primarily in the infrared, letting it see through dust and look back at some of the earliest galaxies. Its 6.5 m segmented gold-coated mirror is far larger than Hubble's 2.4 m mirror. It orbits the Sun near the L2 Lagrange point, about 1.5 million km from Earth.",
         "reference": "Two sentences covering: launched Dec 2021; infrared; early galaxies/dust; 6.5 m mirror vs Hubble 2.4 m; orbits at L2.",
         "checks": [{"type": "max_words", "value": "70"}]},
        {"id": "c4", "tags": ["structured-output"],
         "input": "Extract the people and their ages from this text and return ONLY a JSON array of objects with keys \"name\" and \"age\": 'Maria, who just turned 34, met her nephew Tom (12) and her old friend Kenji, aged 41.'",
         "reference": "[{\"name\":\"Maria\",\"age\":34},{\"name\":\"Tom\",\"age\":12},{\"name\":\"Kenji\",\"age\":41}]",
         "checks": [{"type": "json_valid"}, {"type": "contains", "value": "Kenji"}]},
        {"id": "c5", "tags": ["factual", "hallucination"],
         "input": "Who was the first person to walk on Mars?",
         "reference": "Nobody has walked on Mars yet; a good answer says so and does not invent a person.",
         "checks": []},
        {"id": "c6", "tags": ["writing"],
         "input": "Write a polite two-line reply declining a meeting invite for Friday, offering Monday instead.",
         "reference": "Polite, two lines, declines Friday, proposes Monday.", "checks": [{"type": "contains", "value": "Monday"}]},
    ],
}


def seed_if_empty() -> None:
    if not db.all_docs("models"):
        defaults = {"temperature": 0.7, "max_tokens": 2048, "top_p": None, "system_prompt": None, "base_url": None,
                    "api_key_env": None, "price_input_per_mtok": 0.0, "price_output_per_mtok": 0.0}
        for m in STARTER_MODELS:
            db.put("models", {**defaults, **m})
    if not db.all_docs("suites"):
        db.put("suites", STARTER_SUITE)
