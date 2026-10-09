# Model Evaluator

A personal tool for comparing LLMs side by side, deployable to **Netlify**. You write the eval (test cases, scoring criteria,
automatic checks), run it across any number of models, grade the outputs **blind**, and only then reveal which model was which.
A Gemini-powered AI judge grades the same outputs independently, and can also **audit the eval itself**.

## Deploy to Netlify

1. **Create the site.** In Netlify, go to *Add new project → Import an existing project*, pick this GitHub repo, and set
   **Base directory = `model-evaluator`**. The build command, publish directory and functions are read from `netlify.toml`.
2. **Add a database.** In the project, open the *Database* (Netlify DB, powered by Neon) section and create one. This sets
   `NETLIFY_DATABASE_URL` for your functions. *Alternative:* create a free Neon project and set `DATABASE_URL` yourself.
   Tables are created automatically on first request.
3. **Set environment variables** (*Site configuration → Environment variables*):
   - `APP_PASSWORD`: **required.** The app refuses to serve data without it.
   - `GEMINI_API_KEY`: needed for the AI judge, podcast transcription and voice style guides.
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`: whichever providers you use. You can also paste keys on
     the app's *API keys* page, where they're stored AES-encrypted in the database.
   - `APP_SECRET`: optional. A separate secret for session signing and key encryption (defaults to `APP_PASSWORD`).
4. **Deploy**, open the site, and log in.

### How it runs on Netlify

| Piece | Where |
|---|---|
| React UI | static files in `dist/` |
| REST API | `netlify/functions/api.mts`, mounted at `/api/*` (30 s per request) |
| Eval generation, AI judging, meta-review, podcast transcription, style guides | `netlify/functions/worker-background.mts`, a **background function** (15 min per invocation). Long jobs stop at ~12 minutes and re-queue themselves, so runs of any size finish. If an invocation dies, the run shows *interrupted* and **Resume** picks up where it stopped. |
| Data | Postgres (Netlify DB / Neon) through `server/db.ts`; locally an embedded Postgres (PGlite) in `.data/` |
| Login | one password → signed, httpOnly session cookie (30 days) |

Cost: background functions bill as compute (credits per GB-hour), and they mostly wait on model APIs, so a typical personal
eval uses a fraction of a credit. Your real cost is the model tokens.

## Local development

```bash
npm install
cp .env.example .env     # add keys; leave APP_PASSWORD empty to skip login locally
npm run dev              # http://localhost:8888 (UI + API, jobs run in-process, data in .data/)
npm test                 # 30 tests: blind flow, judge, auth, budgeted job continuation, parsers, podcasts, providers
```

`netlify dev` also works if you have the Netlify CLI. The app works offline out of the box: three **mock** models and a
`mock-judge` are pre-loaded, so you can try every flow without spending tokens.

## Your iCloud voice notes (refresh once or twice a year)

There's no iCloud API to sync from a server, and you don't need one. The voice profile changes slowly, so the routine is:

1. Your existing `audio-transcriber` keeps writing transcripts to **iCloud Drive → Transcripts** on your Mac.
2. Every six months or so, open **Library → Voice notes → Choose folder…** and select that folder (in Finder it's under *iCloud Drive*).
   Your browser reads the `.txt / .json / .srt / .md` files and uploads only the text, in batches. New and edited notes
   are added and unchanged ones are skipped, so re-syncing is safe.
3. Optionally click **Distil a voice style guide**. Gemini reads all the selected notes (up to ~150k tokens) and writes a
   dated guide: tone, signature phrases, rhythm, what you'd never say, and 10–15 verbatim excerpts. Put that guide (plus a
   handful of recent raw notes) in a suite's **Personal context** instead of hundreds of notes. Every request is then cheaper,
   it fits smaller-context models, and each refresh gives you a new dated version you can A/B against the last one.

Voice profiles are given to models as context, not used for fine-tuning, so every provider gets the same information and the
comparison stays fair.

## Built-in eval templates

| Suite | What it tests | Key criteria | Auto checks |
|---|---|---|---|
| **Polish my writing (keep my voice)** | Fixing grammar and tightening free-flow writing or voice-note transcripts *without* losing your tone | Sounds like me (×3), meaning preserved, grammar, concise-not-compressed, no AI-isms, "I'd send it as-is" (human only) | output ≤ 0.95× and ≥ 0.3× input length, no "Here's…" preamble, no "delve" |
| **Reflection & advice** | Thinking out loud and asking for advice (therapy-style) | I feel heard, insight, practical next steps, personalised, honest-not-sycophantic, safe & appropriate, "I'd come back" | ≤ 450 words, no "as an AI" |
| **Podcast summary** | Summarising an episode *and* capturing the back-and-forth between speakers | Faithful (×3), coverage, captures the dialogue, quotes are verbatim, structure, "saves me the listen" | ≤ 700 words, contains a real quote |

The rewrite review screen has a **Show edits vs. input** toggle: a word-level diff with the share of your words that were kept.
Podcast cases show the attached transcript as a speaker-by-speaker conversation.

**Library → Podcasts.** Search by podcast name, pick an episode, and:
- **Get transcript:** used when the feed publishes one (`<podcast:transcript>`). JSON, VTT, SRT and HTML transcripts are all supported.
- **Transcribe with Gemini:** otherwise the background worker downloads the audio (up to 400 MB) and Gemini transcribes it as a
  speaker-labelled dialogue (Files API, `gemini-3.8-flash` by default).

Rename generic speakers (`SPEAKER_00` → a real name) so summaries can say who said what, then attach the episode to a case
in the *Podcast summary* suite.

## How an evaluation works

| Step | What happens |
|---|---|
| **1. Models** | Gemini, Anthropic, OpenAI or any OpenAI-compatible endpoint (OpenRouter, Groq, Together…), plus offline mocks. Each entry is a model *plus* settings and $/M-token pricing. |
| **2. Eval suite** | Test cases (prompt, reference answer, tags, checks, attached transcripts), weighted criteria with rubrics graded by human / AI / both, global checks, and personal context. Import/export JSON. |
| **3. Run** | Pick the suite, how many models (1–8) and which, samples per case, parallelism, blinding mode and judge settings. Models are shuffled onto anonymous labels. |
| **4. Blind review** | Shuffled side-by-side outputs. You score them, and AI scores stay hidden until you finish each case. The rewrite review shows a word-level diff against your original; podcast cases show the transcript as a dialogue. |
| **5. AI judge** | Gemini grades blind, either individually (least position bias) or comparatively. |
| **6. Results** | Leaderboard (final/human/AI, win rate, checks, latency, length, cost, consistency), human↔AI agreement, length bias, and per-case discrimination. |
| **7. Reveal** | Unblind, or re-blind. |
| **8. AI audit** | Gemini critiques the eval's design and your disagreements, and suggests new cases you can add in one click. |

### Metrics reference

- **Score (0–100)**: per output, the weighted mean of criterion scores, each normalised (1..N → 0..1; pass/fail → 0/1). *Final* uses your score where it exists and falls back to the AI judge.
- **Win rate**: for every (case, sample), each pair of models is compared on final score; ties count as ½.
- **Human ↔ AI agreement**: Pearson r, mean absolute difference, % within one scale point, and judge leniency bias, both overall and per criterion. Also shows whether the two rankings match.
- **Length bias**: correlation between score and word count, for the judge and for you.
- **Consistency σ**: mean std-dev of the score across samples of the same case (needs samples > 1).
- **Automatic checks**: contains / not-contains / regex / exact / starts-with / valid JSON / min-max words / max chars / contains-reference.

## Layout

```
src/                  React UI (Vite + TypeScript + Tailwind)
server/               API + jobs (shared by Netlify functions and the local dev server)
netlify/functions/    api.mts (/api/*), worker-background.mts
tests/                vitest
```
