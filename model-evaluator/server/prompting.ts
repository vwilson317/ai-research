/** Assemble what each model (and the judge) sees: suite prompt, personal context and per-case documents. */

const VOICE_INTRO = `Below are samples of the user's own words: transcripts of their voice notes, things they've written, and possibly a style guide distilled from them.
Study them to learn how they talk: vocabulary, rhythm, humour, sentence length, slang and recurring themes in their life.
When you rewrite or respond, sound like *them*, not like a generic assistant. Don't quote these samples unless it helps.`;

const BACKGROUND_INTRO = `Below is personal background about the user, from their own voice notes and writing.
Use it to make your response specific to them and their situation. Don't recite it back to them.`;

export interface RunDoc { id: string; kind: string; title: string; text: string; created_at?: string | null; meta?: Record<string, any> }

export function contextBlock(run: any, kase: any): string {
  const ctx = run.suite.context ?? {};
  const docs: Record<string, RunDoc> = run.docs ?? {};
  const exclude = new Set([...(kase.context_doc_ids ?? []), kase.source_doc_id]);
  const chosen = (ctx.doc_ids ?? []).filter((i: string) => docs[i] && !exclude.has(i)).map((i: string) => docs[i]) as RunDoc[];
  if (!chosen.length) return '';
  // Style guides first (dense signal), then newest notes, within the character budget.
  chosen.sort((a, b) => Number(!!b.meta?.style_guide) - Number(!!a.meta?.style_guide) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const budget = ctx.max_chars ?? 24000;
  const parts: string[] = [];
  let used = 0;
  for (const d of chosen) {
    let text = d.text.trim();
    if (used + text.length > budget) text = text.slice(0, Math.max(0, budget - used));
    if (!text) break;
    parts.push(`<sample title="${d.title}" date="${(d.created_at ?? '').slice(0, 10)}">\n${text}\n</sample>`);
    used += text.length;
  }
  const voice = (ctx.role ?? 'voice') === 'voice';
  const tag = voice ? 'user_voice_samples' : 'user_background';
  return `${voice ? VOICE_INTRO : BACKGROUND_INTRO}\n\n<${tag}>\n${parts.join('\n')}\n</${tag}>`;
}

export function systemPrompt(run: any, kase: any, model?: any): string | null {
  return [run.suite.system_prompt, contextBlock(run, kase), model?.system_prompt].filter(Boolean).join('\n\n') || null;
}

export function caseDocuments(run: any, kase: any): string {
  const docs: Record<string, RunDoc> = run.docs ?? {};
  return (kase.context_doc_ids ?? []).map((i: string) => docs[i]).filter(Boolean).map((d: RunDoc) => {
    const label = d.kind === 'podcast' || d.kind === 'voice_note' ? 'transcript' : 'document';
    return `<${label} title="${d.title}">\n${d.text}\n</${label}>`;
  }).join('\n\n');
}

export function userPrompt(run: any, kase: any): string {
  const docs = caseDocuments(run, kase);
  return docs ? `${docs}\n\n${kase.input}` : kase.input;
}
