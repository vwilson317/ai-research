# Model Evaluator

A personal tool for comparing LLMs side by side. You write the eval (test cases, scoring criteria,
automatic checks), run it across any number of models, grade the outputs **blind**, and only then
reveal which model was which. A Gemini-powered AI judge grades the same outputs independently, and
can also **audit the eval itself**.

![flow](https://img.shields.io/badge/flow-define%20→%20run%20→%20blind%20grade%20→%20AI%20judge%20→%20reveal%20→%20audit-indigo)

## Quick start

```bash
cp .env.example .env          # add GEMINI_API_KEY (needed for the AI judge) + any provider keys
docker compose up --build     # → http://localhost:8000
```

Or without Docker (Python 3.11+, Node 20+):

```bash
make install
make dev                      # API on :8000, UI on http://localhost:5173
```

It works offline out of the box: the starter data includes three **mock** models and a `mock-judge`.
Use them to try the whole flow without spending any tokens.

## How it works

| Step | What happens |
|---|---|
| **1. Models** | Add contestants: Gemini, Anthropic, OpenAI, or any OpenAI-compatible endpoint (OpenRouter, Ollama, Groq…). Each entry is a model *plus* settings (temperature, top-p, max tokens, extra system prompt, $/M-token pricing), so you can compare one model at two temperatures, for example. A ⚡ button sends a test request. |
| **2. Eval suite** | Test cases (prompt, optional reference answer, tags, per-case automatic checks), scoring criteria (1–N scale or pass/fail, weight, rubric, graded by human / AI / both), and global checks. Add criteria from a built-in library (correctness, faithfulness, hallucination, instruction following, reasoning, code quality, safety, tone…). Bulk-paste cases, or import/export JSON. |
| **3. Run** | Choose the suite, the **number of models** (1–8) and which ones, samples per case (for consistency/variance), parallelism, blinding mode and AI-judge settings. Models are shuffled onto anonymous labels (Model A, B, C…). |
| **4. Blind review** | Responses for each case appear side by side in shuffled order. You score each criterion. Automatic-check results, latency and token counts are shown; model names are not. AI-judge scores stay hidden until you've finished that case, so they can't anchor you. *Strict* blinding relabels responses per case ("Response 1/2/3"), so you can't follow a model's style from case to case. |
| **5. AI judge** | Gemini (`gemini-3.8-flash` by default, configurable) grades every output against the same rubric, without seeing model names. **Individual** mode grades each output alone (least position bias). **Comparative** mode shows the judge all responses for a case at once, in shuffled order (better relative calibration). |
| **6. Results** | Leaderboard: final / human / AI score (weighted, 0–100), pairwise win rate, auto-check pass rate, latency avg + p95, output length, cost, score σ across samples, and errors. Charts of human vs AI scores, overall and per criterion. A case × model heat table sorted by *spread* shows cases that don't separate the models. |
| **7. Reveal** | Unblinds the leaderboard and review screens. You can re-blind afterwards. |
| **8. AI audit of the eval** | The judge reviews the suite design plus the anonymised results and your disagreements with it. It reports a quality score, issues by severity, vague rubrics (with suggested rewrites), cases that don't discriminate, judge-reliability notes, and suggested new test cases that you can add to the suite in one click. |

### Metrics reference

- **Score (0–100)**: per output, the weighted mean of criterion scores, each normalised (1..N → 0..1; pass/fail → 0/1). *Final* uses your score where it exists and falls back to the AI judge.
- **Win rate**: for every (case, sample), each pair of models is compared on final score; ties count as ½.
- **Human ↔ AI agreement**: Pearson r, mean absolute difference, % within one scale point, and judge leniency bias, both overall and per criterion. Also shows whether the two rankings match.
- **Length bias**: correlation between score and word count, for the judge and for you.
- **Consistency σ**: mean std-dev of the score across samples of the same case (needs samples > 1).
- **Automatic checks**: contains / not-contains / regex / exact / starts-with / valid JSON / min-max words / max chars / contains-reference.

## Layout

```
backend/   FastAPI + SQLite (app/providers.py, judge.py, runner.py, stats.py, checks.py)
frontend/  React + Vite + TypeScript + Tailwind
```

The data lives in `backend/data/evaluator.db` (in Docker, the `eval-data` volume). API keys pasted in the UI
are stored in that local database. Environment variables / `.env` work as well. `GET /api/runs/{id}/export`
dumps a run's outputs, scores and stats as JSON. Interactive API docs are at `/docs`.

## Tests

```bash
make test   # backend: full blind flow with mock models + judge, provider request shapes; frontend: typecheck
```
