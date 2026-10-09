/** Find a podcast by name, list episodes, get a transcript: from the feed if published, else transcribe with Gemini. */
import { XMLParser } from 'fast-xml-parser';
import { createWriteStream } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as db from './db.ts';
import * as library from './library.ts';
import * as providers from './providers.ts';
import { ProviderError } from './providers.ts';
import { newId, sleep } from './util.ts';

const UA = { 'user-agent': 'model-evaluator/0.2 (personal use)' };
const MAX_FEED_BYTES = 60 * 1024 * 1024;
const MAX_AUDIO_BYTES = 400 * 1024 * 1024; // Netlify functions have ~512 MB of /tmp
const FORMAT_RANK = ['application/json', 'text/vtt', 'application/x-subrip', 'application/srt', 'text/srt', 'text/html', 'text/plain'];

export async function search(term: string, limit = 10) {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, media: 'podcast', entity: 'podcast', limit: String(limit) })}`;
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) { // Apple throttles with sporadic 403/429s
    res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (![403, 429, 503].includes(res.status)) break;
    await sleep(1500 * (attempt + 1));
  }
  if (!res!.ok) throw new ProviderError(`Podcast search failed: HTTP ${res!.status}`);
  const data = JSON.parse(await res!.text());
  return (data.results ?? []).filter((x: any) => x.feedUrl).map((x: any) => ({
    name: x.collectionName, author: x.artistName, feed_url: x.feedUrl, artwork: x.artworkUrl100, episodes: x.trackCount, genre: x.primaryGenreName,
  }));
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: any): string => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();

async function fetchFeed(feedUrl: string) {
  const res = await fetch(feedUrl, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new ProviderError(`Feed HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_FEED_BYTES) throw new ProviderError('Feed too large');
  const xml = await res.text();
  if (xml.length > MAX_FEED_BYTES) throw new ProviderError('Feed too large');
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, htmlEntities: true }).parse(xml);
}

function episode(item: any) {
  const enc = asArray(item.enclosure)[0];
  const transcripts = asArray(item['podcast:transcript']).filter((t: any) => t?.['@_url'])
    .map((t: any) => ({ url: t['@_url'], type: String(t['@_type'] ?? '').toLowerCase() }));
  const desc = txt(item['itunes:summary']) || txt(item.description);
  return {
    guid: (txt(item.guid) || enc?.['@_url'] || txt(item.title)).trim(),
    title: txt(item.title), published: txt(item.pubDate) || null, duration: txt(item['itunes:duration']) || null,
    audio_url: enc?.['@_url'] ?? null, audio_type: enc?.['@_type'] ?? null,
    description: desc ? library.htmlToText(desc).replace(/\s+/g, ' ').trim().slice(0, 400) : '',
    transcripts,
  };
}

export async function episodes(feedUrl: string, limit = 100) {
  const feed = await fetchFeed(feedUrl);
  const ch = feed?.rss?.channel;
  if (!ch) throw new ProviderError('Not an RSS podcast feed');
  return { podcast: txt(ch.title), author: txt(ch['itunes:author']) || null, episodes: asArray(ch.item).slice(0, limit).map(episode) };
}

async function fetchFeedTranscript(ep: ReturnType<typeof episode>) {
  const rank = (t: { type: string }) => { const i = FORMAT_RANK.findIndex((f) => t.type.includes(f)); return i < 0 ? 99 : i; };
  let lastErr: unknown = null;
  for (const t of [...ep.transcripts].sort((a, b) => rank(a) - rank(b))) {
    try {
      const res = await fetch(t.url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const segs = library.parseTranscript(await res.text(), t.type || res.headers.get('content-type') || '', t.url);
      if (segs.length) return { segs, url: t.url };
    } catch (e) { lastErr = e; }
  }
  throw new ProviderError(`Feed transcript unusable: ${(lastErr as Error)?.message}`);
}

export const TRANSCRIBE_PROMPT = `Transcribe this podcast episode as a dialogue.
- Identify speakers by their real names when the episode makes them clear (host intros, "thanks for having me, X"); otherwise use "Host", "Guest", "Speaker 3".
- One speaker turn per paragraph, formatted exactly as \`Name: what they said\`, separated by blank lines.
- Keep the words faithful; drop filler ("um", "uh") and false starts; do not summarise or skip sections, including ads.
- Output only the transcript.`;

export async function transcribeWithGemini(audioUrl: string, model: string, title: string) {
  const key = await providers.keyFor('google');
  if (!key) throw new ProviderError('GEMINI_API_KEY is required to transcribe episodes that have no published transcript');
  const path = join(tmpdir(), `${newId('audio')}.bin`);
  const G = providers.GEMINI;
  try {
    const res = await fetch(audioUrl, { headers: UA, redirect: 'follow' });
    if (!res.ok || !res.body) throw new ProviderError(`Audio download failed: HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_AUDIO_BYTES) throw new ProviderError('Audio file too large (over 400 MB)');
    let mime = (res.headers.get('content-type') ?? '').split(';')[0];
    if (!/^(audio|video)\//.test(mime)) mime = 'audio/mpeg';
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(path));
    const size = (await stat(path)).size;
    if (size > MAX_AUDIO_BYTES) throw new ProviderError('Audio file too large (over 400 MB)');

    // Gemini Files API: resumable upload, then wait until the file is ACTIVE.
    const start = await fetch(`${G}/upload/v1beta/files`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': mime, 'content-type': 'application/json' },
      body: JSON.stringify({ file: { display_name: title.slice(0, 100) } }),
    });
    if (!start.ok) throw new ProviderError(`Gemini upload start failed: ${(await start.text()).slice(0, 300)}`);
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new ProviderError('Gemini did not return an upload URL');
    const up = await fetch(uploadUrl, {
      method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: await readFile(path),
    });
    if (!up.ok) throw new ProviderError(`Gemini upload failed: ${(await up.text()).slice(0, 300)}`);
    let gfile = (await up.json()).file;
    for (let i = 0; i < 120 && gfile.state !== 'ACTIVE'; i++) {
      if (gfile.state === 'FAILED') throw new ProviderError('Gemini could not process the audio file');
      await sleep(5000);
      gfile = await (await fetch(`${G}/v1beta/${gfile.name}`, { headers: { 'x-goog-api-key': key } })).json();
    }
    let data: any;
    try {
      const r = await fetch(`${G}/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ fileData: { mimeType: gfile.mimeType ?? mime, fileUri: gfile.uri } }, { text: TRANSCRIBE_PROMPT }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 65536 },
        }),
      });
      if (!r.ok) throw new ProviderError(`Gemini transcription failed: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
      data = await r.json();
    } finally {
      await fetch(`${G}/v1beta/${gfile.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => undefined);
    }
    const { text, finish } = providers.geminiText(data);
    if (!text.trim()) throw new ProviderError(`Gemini returned an empty transcript (${finish})`);
    return { segs: library.parseSpeakerLines(text), meta: { transcribed_by: model, truncated: finish === 'MAX_TOKENS', usage: data.usageMetadata } };
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

/** Background job: fill in the placeholder library doc with the episode transcript. */
export async function importEpisode(docId: string, feedUrl: string, guid: string, mode: 'auto' | 'feed' | 'transcribe') {
  const doc = (await db.get('library', docId))!;
  try {
    const feed = await episodes(feedUrl, 100000);
    const ep = feed.episodes.find((e) => e.guid === guid);
    if (!ep) throw new ProviderError('Episode not found in feed');
    Object.assign(doc, { title: `${feed.podcast} — ${ep.title}`, source: ep.audio_url,
      meta: { ...doc.meta, podcast: feed.podcast, episode: ep.title, published: ep.published, duration: ep.duration, feed_url: feedUrl } });
    let segs: library.Segment[] | null = null;
    let how: Record<string, unknown> = {};
    if ((mode === 'auto' || mode === 'feed') && ep.transcripts.length) {
      try { const r = await fetchFeedTranscript(ep); segs = r.segs; how = { transcript_source: 'feed', transcript_url: r.url }; }
      catch (e) { if (mode === 'feed') throw e; }
    }
    if (!segs) {
      if (mode === 'feed') throw new ProviderError("This episode has no published transcript; use 'Transcribe with Gemini'");
      if (!ep.audio_url) throw new ProviderError('Episode has no audio enclosure');
      Object.assign(doc, { status: 'processing', meta: { ...doc.meta, step: 'transcribing audio with Gemini' } });
      await library.save(doc);
      const model = (await db.getSetting('TRANSCRIBE_MODEL')) || 'gemini-3.8-flash';
      const r = await transcribeWithGemini(ep.audio_url, model, doc.title);
      segs = r.segs; how = { ...r.meta, transcript_source: 'gemini' };
    }
    Object.assign(doc, { segments: segs, text: library.segmentsToText(segs), status: 'ready', error: null, meta: { ...doc.meta, ...how, step: null } });
  } catch (e) {
    Object.assign(doc, { status: 'error', error: String((e as Error).message ?? e).slice(0, 800) });
  }
  await library.save(doc);
}
