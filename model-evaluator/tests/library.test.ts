import { describe, expect, it } from 'vitest';
import * as db from '../server/db.ts';
import * as library from '../server/library.ts';
import * as podcasts from '../server/podcasts.ts';
import * as prompting from '../server/prompting.ts';
import { api, stubFetch, useFreshApp, waitForRun } from './helpers.ts';
import * as jobs from '../server/jobs.ts';

describe('transcript parsing', () => {
  it('vtt with voice tags', () => {
    const raw = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Maya>Hello there.\n\n00:00:03.000 --> 00:00:05.000\n<v Maya>Still me.\n\n00:00:05.000 --> 00:00:07.000\n<v Dev>Hi Maya.';
    const segs = library.parseTranscript(raw, 'text/vtt');
    expect(segs.map((s) => s.speaker)).toEqual(['Maya', 'Dev']);
    expect(segs[0].text).toBe('Hello there. Still me.');
  });
  it('podcast-namespace json', () => {
    const raw = JSON.stringify({ segments: [{ speaker: 'Host', startTime: 0, body: 'Welcome' }, { speaker: 'Host', startTime: 1, body: 'back.' }, { speaker: 'Guest', startTime: 2, body: 'Thanks!' }] });
    expect(library.parseTranscript(raw, 'application/json')).toEqual([{ speaker: 'Host', text: 'Welcome back.', start: 0 }, { speaker: 'Guest', text: 'Thanks!', start: 2 }]);
  });
  it('whisper json falls back to text when segments are empty', () => {
    expect(library.parseTranscript(JSON.stringify({ text: ' idea ', segments: [] }), '', 'a.json')).toEqual([{ speaker: null, text: 'idea', start: null }]);
  });
  it('srt, html and plain', () => {
    expect(library.parseTranscript('1\n00:00:01,000 --> 00:00:02,000\nAlex: First\n\n2\n00:00:02,000 --> 00:00:03,000\nSam: Second', '', 'x.srt').map((s) => s.speaker)).toEqual(['Alex', 'Sam']);
    const segs = library.parseTranscript('<html><p>Alex: Hi &amp; welcome</p><p>Sam: Thanks</p><script>x()</script></html>', 'text/html');
    expect(segs[segs.length - 1]).toEqual({ speaker: 'Sam', text: 'Thanks', start: null });
    expect(segs[0].text).toBe('Hi & welcome');
    expect(library.parseSpeakerLines('just a monologue\nwith two lines')[0].speaker).toBeNull();
  });
});

describe('library + context', () => {
  useFreshApp();

  it('imports voice notes picked from a folder, deduped by recording', async () => {
    const files = [
      { path: 'Transcripts/sub/Morning walk_transcript.txt', text: 'so I was thinking about the move again', modified: '2026-03-01T00:00:00Z' },
      { path: 'Transcripts/sub/Morning walk_transcript.json', text: JSON.stringify({ text: 'duplicate' }) },
      { path: 'Transcripts/sub/Idea_transcript.json', text: JSON.stringify({ text: ' app idea dump ', segments: [] }) },
      { path: 'Transcripts/empty.txt', text: '   ' },
      { path: 'Transcripts/.DS_Store', text: 'x' },
      { path: 'Transcripts/clip.m4a', text: 'binary' },
    ];
    expect((await api('POST', '/library/voice-notes', { files })).json).toEqual({ added: 2, updated: 0, skipped: 4 });
    expect((await api('POST', '/library/voice-notes', { files })).json.added).toBe(0);
    const changed = [{ ...files[0], text: 'edited later' }];
    expect((await api('POST', '/library/voice-notes', { files: changed })).json.updated).toBe(1);
    const notes = (await api('GET', '/library?kind=voice_note')).json;
    expect(notes.map((n: any) => n.title).sort()).toEqual(['Idea', 'Morning walk']);
    expect(notes[0].text).toBeUndefined();
  });

  it('injects context newest-first, style guides first, excluding the case source', () => {
    const run = {
      suite: { system_prompt: 'Be an editor.', context: { doc_ids: ['a', 'b', 'g'], role: 'voice', max_chars: 1000 } },
      docs: {
        a: { id: 'a', kind: 'voice_note', title: 'Note A', text: 'yo whats good', created_at: '2026-02-01' },
        b: { id: 'b', kind: 'voice_note', title: 'Note B', text: 'the case itself', created_at: '2026-03-01' },
        g: { id: 'g', kind: 'document', title: 'Guide', text: 'STYLE GUIDE', created_at: '2026-01-01', meta: { style_guide: true } },
        p: { id: 'p', kind: 'podcast', title: 'Ep', text: 'Host: hi', created_at: null },
      },
    };
    const kase = { input: 'fix this', source_doc_id: 'b', context_doc_ids: ['p'] };
    const sys = prompting.systemPrompt(run, kase, { system_prompt: 'Model extra.' })!;
    expect(sys).toContain('Be an editor.');
    expect(sys).toContain('yo whats good');
    expect(sys).not.toContain('the case itself');
    expect(sys.indexOf('STYLE GUIDE')).toBeLessThan(sys.indexOf('yo whats good'));
    expect(sys.endsWith('Model extra.')).toBe(true);
    const user = prompting.userPrompt(run, kase);
    expect(user.startsWith('<transcript title="Ep">')).toBe(true);
    expect(user.endsWith('fix this')).toBe(true);
  });

  it('seeds the three templates and runs them end to end', async () => {
    const suites = Object.fromEntries((await api('GET', '/suites')).json.map((s: any) => [s.id, s]));
    expect(Object.keys(suites)).toEqual(expect.arrayContaining(['s_voice_rewrite', 's_reflection_advice', 's_podcast_summary']));
    const sample = (await api('GET', '/library/doc_sample_podcast')).json;
    expect(new Set(sample.segments.map((s: any) => s.speaker))).toEqual(new Set(['Maya', 'Dev']));

    const note = (await api('POST', '/library', { kind: 'voice_note', title: 'me', text: 'honestly lowkey love this' })).json;
    const s = suites.s_voice_rewrite;
    s.context.doc_ids = [note.id];
    expect((await api('PUT', `/suites/${s.id}`, s)).status).toBe(200);

    const mocks = (await api('GET', '/models')).json.filter((m: any) => m.provider === 'mock').slice(0, 2).map((m: any) => m.id);
    for (const sid of ['s_voice_rewrite', 's_podcast_summary', 's_reflection_advice']) {
      const { json } = await api('POST', '/runs', { suite_id: sid, model_ids: mocks, judge: { enabled: true, model: 'mock-judge' } });
      const r = await waitForRun(json.id);
      expect(r.judge_status).toBe('done');
      expect(r.docs).toBeUndefined();
      if (sid === 's_podcast_summary') {
        expect(r.doc_titles.doc_sample_podcast.kind).toBe('podcast');
        expect((await api('GET', `/runs/${json.id}/docs/doc_sample_podcast`)).json.text).toContain('Maya');
      }
      if (sid === 's_voice_rewrite') {
        expect(r.doc_titles[note.id]).toBeTruthy();
        const items = (await api('GET', `/runs/${json.id}/review`)).json.units[0].items;
        expect(items[0].checks.some((c: any) => c.check.includes('input length'))).toBe(true);
      }
    }
  });

  it('renames speakers', async () => {
    const doc = (await api('POST', '/library', { kind: 'podcast', title: 't', text: 'SPEAKER_00: hi\n\nSPEAKER_01: hey\n\nSPEAKER_00: bye' })).json;
    const out = (await api('POST', `/library/${doc.id}/speakers`, { SPEAKER_00: 'Travis', SPEAKER_01: 'Eric' })).json;
    expect(out.segments.map((s: any) => s.speaker)).toEqual(['Travis', 'Eric', 'Travis']);
    expect(out.text.startsWith('Travis: hi')).toBe(true);
  });

  it('distils a voice style guide in the background', async () => {
    const a = (await api('POST', '/library', { kind: 'voice_note', title: 'a', text: 'kind of mad I waited three weeks' })).json;
    const doc = (await api('POST', '/library/style-guide', { doc_ids: [a.id], model: 'mock-judge' })).json;
    expect(doc.status).toBe('processing');
    await jobs.idle();
    const done = (await api('GET', `/library/${doc.id}`)).json;
    expect(done.status).toBe('ready');
    expect(done.meta.style_guide).toBe(true);
    expect(done.text).toContain('style guide');
  });
});

const FEED = `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
<title>Test Pod</title><itunes:author>Tester</itunes:author>
<item><title>Ep 2</title><guid isPermaLink="false">g2</guid><enclosure url="https://cdn.test/ep2.mp3" type="audio/mpeg"/></item>
<item><title>Ep 1</title><guid>g1</guid><enclosure url="https://cdn.test/ep1.mp3" type="audio/mpeg"/>
<description>&lt;p&gt;About &lt;b&gt;habits&lt;/b&gt;&lt;/p&gt;</description>
<podcast:transcript url="https://cdn.test/ep1.html" type="text/html"/>
<podcast:transcript url="https://cdn.test/ep1.json" type="application/json"/></item>
</channel></rss>`;

describe('podcasts (mocked network)', () => {
  useFreshApp();

  function fakeNet() {
    return stubFetch((url, init) => {
      if (url.startsWith('https://feed.test')) return new Response(FEED);
      if (url === 'https://cdn.test/ep1.json') return Response.json({ segments: [{ speaker: 'Ann', body: 'Habits win.' }, { speaker: 'Bo', body: 'Goals matter.' }] });
      if (url === 'https://cdn.test/ep2.mp3') return new Response('ID3fakeaudio', { headers: { 'content-type': 'audio/mpeg' } });
      if (url.includes('upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://upload.test/session' } });
      if (url === 'https://upload.test/session') return Response.json({ file: { name: 'files/abc', uri: 'https://g/files/abc', mimeType: 'audio/mpeg', state: 'ACTIVE' } });
      if (url.endsWith(':generateContent')) {
        const body = JSON.parse(init.bodyText!);
        expect(body.contents[0].parts[0].fileData.fileUri).toBe('https://g/files/abc');
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Host: Welcome to episode two.\n\nGuest: Glad to be here.' }] } }] });
      }
      if (init.method === 'DELETE') return Response.json({});
      return undefined;
    });
  }

  it('lists episodes and prefers the JSON feed transcript', async () => {
    fakeNet();
    const eps = await podcasts.episodes('https://feed.test/rss');
    expect(eps.podcast).toBe('Test Pod');
    expect(eps.episodes.map((e) => e.guid)).toEqual(['g2', 'g1']);
    expect(eps.episodes[1].description).toBe('About habits');
    const doc = library.makeDoc('podcast', 'x', '', { status: 'processing' });
    await library.save(doc);
    await podcasts.importEpisode(doc.id, 'https://feed.test/rss', 'g1', 'auto');
    const d = (await db.get('library', doc.id))!;
    expect(d.status).toBe('ready');
    expect(d.meta.transcript_url).toMatch(/\.json$/);
    expect(d.segments.map((s: any) => s.speaker)).toEqual(['Ann', 'Bo']);
    expect(d.title).toBe('Test Pod — Ep 1');
  });

  it('falls back to Gemini transcription (Files API) and cleans up', async () => {
    const calls = fakeNet();
    process.env.GEMINI_API_KEY = 'k';
    const doc = library.makeDoc('podcast', 'x', '', { status: 'processing' });
    await library.save(doc);
    await podcasts.importEpisode(doc.id, 'https://feed.test/rss', 'g2', 'auto');
    const d = (await db.get('library', doc.id))!;
    expect(d.error).toBeNull();
    expect(d.meta).toMatchObject({ transcript_source: 'gemini', truncated: false });
    expect(d.segments.map((s: any) => s.speaker)).toEqual(['Host', 'Guest']);
    expect(calls).toContainEqual({ method: 'DELETE', url: 'https://generativelanguage.googleapis.com/v1beta/files/abc' });

    const doc2 = library.makeDoc('podcast', 'x', '', { status: 'processing' });
    await library.save(doc2);
    await podcasts.importEpisode(doc2.id, 'https://feed.test/rss', 'g2', 'feed');
    expect((await db.get('library', doc2.id))!.status).toBe('error');
  });
});
