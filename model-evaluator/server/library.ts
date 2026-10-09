/** Personal context library: voice-note transcripts, podcast transcripts, documents. */
import { createHash } from 'node:crypto';
import * as db from './db.ts';
import { newId, now, words } from './util.ts';

export interface Segment { speaker: string | null; text: string; start?: number | null }

export function makeDoc(kind: string, title: string, text = '', extra: Record<string, any> = {}) {
  const doc: Record<string, any> = {
    id: newId('doc'), kind, title: title.trim() || 'Untitled', text, segments: null, source: null, status: 'ready', error: null,
    created_at: now(), imported_at: now(), meta: {}, ...extra,
  };
  doc.word_count = words(doc.text);
  return doc as db.Doc;
}

export function save(doc: db.Doc) {
  doc.word_count = words(doc.text);
  return db.put('library', doc);
}

// ---------------- transcript parsing ----------------

const TS = /^\s*\d{1,2}:\d{2}(:\d{2})?[.,]\d{1,3}\s*-->/;
export const SPEAKER_LINE = /^\s*([A-Z][\w .'-]{0,40}?|Speaker \d+|SPEAKER_\d+)\s*:\s+([\s\S]+)$/;

export function mergeSegments(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const text = (s.text ?? '').trim();
    if (!text) continue;
    const sp = (s.speaker ?? '').trim() || null;
    if (out.length && out[out.length - 1].speaker === sp) out[out.length - 1].text += ' ' + text;
    else out.push({ speaker: sp, text, start: s.start ?? null });
  }
  return out;
}

export const segmentsToText = (segs: Segment[]) => segs.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n\n');

export function parseSpeakerLines(text: string): Segment[] {
  const segs: Segment[] = [];
  for (const raw of text.trim().split(/\n\s*\n|\n(?=[A-Z][\w .'-]{0,40}:\s)/)) {
    const para = raw.trim();
    if (!para) continue;
    const m = para.replace(/\n/g, ' ').match(SPEAKER_LINE);
    segs.push(m ? { speaker: m[1].trim(), text: m[2] } : { speaker: null, text: para });
  }
  return mergeSegments(segs);
}

export function parseVttSrt(raw: string): Segment[] {
  const segs: Segment[] = [];
  for (const block of raw.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim())
      .filter((l) => !TS.test(l) && !/^\d+$/.test(l.trim()) && !/^(WEBVTT|NOTE|STYLE)/.test(l));
    if (!lines.length) continue;
    const text = lines.join(' ');
    const v = text.match(/^<v(?:\.[^ >]*)?\s+([^>]+)>(.*)$/);
    if (v) { segs.push({ speaker: v[1].trim(), text: v[2].replace(/<\/?v[^>]*>/g, '') }); continue; }
    const m = text.match(SPEAKER_LINE);
    segs.push(m ? { speaker: m[1], text: m[2] } : { speaker: null, text });
  }
  for (const s of segs) s.text = s.text.replace(/<[^>]+>/g, '');
  return mergeSegments(segs);
}

export function parseJsonTranscript(raw: string): Segment[] {
  const data = JSON.parse(raw);
  if (data && Array.isArray(data.segments)) { // podcast namespace or whisper json
    const segs = mergeSegments(data.segments.filter((s: any) => s && typeof s === 'object').map((s: any) => ({
      speaker: s.speaker ?? null, text: s.body ?? s.text ?? '', start: s.startTime ?? s.start ?? null })));
    if (segs.length && (segs.some((s) => s.speaker) || typeof data.text !== 'string')) return segs;
  }
  if (data && typeof data.text === 'string') return [{ speaker: null, text: data.text.trim(), start: null }];
  throw new Error('Unrecognised JSON transcript format');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const unescape = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isNaN(n) ? m : String.fromCodePoint(n); }
  return ENTITIES[e.toLowerCase()] ?? m;
});

export function htmlToText(raw: string): string {
  let t = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h\d>|<\/li>/gi, '\n\n');
  t = unescape(t.replace(/<[^>]+>/g, ' '));
  t = t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
  return t.replace(/^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/gm, '');
}

export const parseHtmlTranscript = (raw: string) => parseSpeakerLines(htmlToText(raw));

export function parseTranscript(raw: string, mime = '', name = ''): Segment[] {
  mime = mime.toLowerCase(); name = name.toLowerCase();
  if (mime.includes('json') || name.endsWith('.json')) return parseJsonTranscript(raw);
  if (/vtt|srt|subrip/.test(mime) || /\.(vtt|srt)$/.test(name)) return parseVttSrt(raw);
  if (mime.includes('html') || /\.html?$/.test(name) || raw.trimStart().startsWith('<')) return parseHtmlTranscript(raw);
  return parseSpeakerLines(raw);
}

// ---------------- voice notes uploaded from the browser (folder picker) ----------------

export interface UploadedFile { path: string; text: string; modified?: string | null }

function voiceText(f: UploadedFile): string {
  if (/\.(json|srt|vtt)$/i.test(f.path)) {
    try {
      const segs = parseTranscript(f.text, '', f.path);
      return segs.every((s) => !s.speaker) ? segs.map((s) => s.text).join(' ') : segmentsToText(segs);
    } catch { return f.text; }
  }
  return f.text.trim();
}

/** Upsert voice notes keyed by relative path; one note per recording even if the transcriber wrote .txt and .json. */
export async function importVoiceNotes(files: UploadedFile[]) {
  const existing = new Map<string, db.Doc>();
  const stems = new Set<string>();
  for (const d of await db.all('library')) {
    if (d.kind !== 'voice_note') continue;
    if (d.source) existing.set(d.source, d);
    if (d.meta?.stem) stems.add(d.meta.stem);
  }
  let added = 0, updated = 0, skipped = 0;
  // When the transcriber wrote several formats for one recording, keep the plain-text one.
  const rank = (p: string) => ['.txt', '.md', '.json', '.srt', '.vtt'].findIndex((e) => p.toLowerCase().endsWith(e)) >>> 0;
  for (const f of [...files].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path))) {
    if (!/\.(txt|md|json|srt|vtt)$/i.test(f.path) || /(^|\/)\./.test(f.path)) { skipped++; continue; }
    const text = voiceText(f);
    if (!text.trim()) { skipped++; continue; }
    const name = f.path.split('/').pop()!;
    const stemKey = f.path.replace(/(_transcript)?\.\w+$/i, '');
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    const prev = existing.get(f.path);
    if (prev) {
      if (prev.meta?.hash !== hash) {
        Object.assign(prev, { text, created_at: f.modified ?? prev.created_at, meta: { ...prev.meta, hash } });
        await save(prev); updated++;
      } else skipped++;
      continue;
    }
    if (stems.has(stemKey)) { skipped++; continue; }
    const title = name.replace(/(_transcript)?\.\w+$/i, '').replace(/_/g, ' ');
    const doc = makeDoc('voice_note', title, text, { source: f.path, created_at: f.modified ?? now(), meta: { stem: stemKey, hash } });
    await save(doc);
    existing.set(f.path, doc); stems.add(stemKey); added++;
  }
  return { added, updated, skipped };
}

// ---------------- resolving docs for run snapshots ----------------

export async function resolve(ids: string[]) {
  const out: Record<string, any> = {};
  for (const i of ids) {
    const d = await db.get('library', i);
    if (d && d.status === 'ready') out[i] = { id: i, kind: d.kind, title: d.title, text: d.text ?? '', created_at: d.created_at,
      segments: d.segments ?? null, meta: { style_guide: !!d.meta?.style_guide } };
  }
  return out;
}
