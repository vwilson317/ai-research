import { useEffect, useRef, useState } from 'react';
import { AudioLines, FileText, FolderInput, Loader2, Mic, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import type { DocKind, Episode, LibraryDocSummary, PodcastShow } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Tabs, useAsync } from '../components/ui';

type Tab = 'voice_note' | 'podcast' | 'document';

async function readUpload(f: File): Promise<string> {
  const raw = await f.text();
  if (!f.name.toLowerCase().endsWith('.json')) return raw;
  try {
    const d = JSON.parse(raw);
    if (Array.isArray(d?.segments) && d.segments.some((s: { speaker?: string }) => s.speaker))
      return d.segments.map((s: { speaker?: string; body?: string; text?: string }) => `${s.speaker ?? 'Speaker'}: ${s.body ?? s.text ?? ''}`).join('\n\n');
    if (typeof d?.text === 'string') return d.text;
  } catch { /* fall through */ }
  return raw;
}

function DocList({ docs, onDelete }: { docs: LibraryDocSummary[]; onDelete: (id: string) => void }) {
  if (docs.length === 0) return <Empty>Nothing here yet.</Empty>;
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {docs.map((d) => (
        <div key={d.id} className="flex items-start gap-3 border-b border-zinc-100 px-4 py-2.5 last:border-0 dark:border-zinc-800">
          <a href={`#/library/${d.id}`} className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium hover:text-indigo-600">{d.title}</span>
              {d.status === 'processing' && <Badge color="indigo"><Loader2 className="h-3 w-3 animate-spin" /> {String(d.meta?.step ?? 'processing')}</Badge>}
              {d.status === 'error' && <Badge color="red">error</Badge>}
              {d.has_segments && <Badge>{d.speakers.length} speakers</Badge>}
              {d.meta?.transcript_source === 'gemini' && <Badge color="amber">transcribed by Gemini</Badge>}
              {d.meta?.transcript_source === 'feed' && <Badge color="green">published transcript</Badge>}
              {Boolean(d.meta?.style_guide) && <Badge color="indigo"><Sparkles className="h-3 w-3" /> voice style guide</Badge>}
            </div>
            <div className="text-xs text-zinc-500">{d.created_at?.slice(0, 10)} · {d.word_count.toLocaleString()} words</div>
            {d.status === 'error' ? <div className="text-xs text-red-600">{d.error}</div> : <div className="line-clamp-1 text-xs text-zinc-500">{d.preview}</div>}
          </a>
          <Button variant="ghost" title="Delete" onClick={() => { if (confirm(`Delete "${d.title}"?`)) onDelete(d.id); }}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
    </div>
  );
}

function PasteCard({ kind, onDone }: { kind: DocKind; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList) => {
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        await api.createDoc({ kind, title: f.name.replace(/(_transcript)?\.\w+$/, '').replace(/_/g, ' '), text: await readUpload(f),
          created_at: new Date(f.lastModified).toISOString() });
      }
      onDone();
    } catch (e) { setErr(String(e)); }
  };
  return (
    <Card title={kind === 'podcast' ? 'Paste a transcript' : kind === 'voice_note' ? 'Add notes manually' : 'Add a document'}
      actions={<>
        <input ref={fileRef} type="file" multiple accept=".txt,.md,.json,.srt,.vtt" hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        <Button variant="ghost" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload files</Button>
      </>}>
      <div className="space-y-2">
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={kind === 'podcast' ? 'Name: what they said\n\nOther name: reply…' : 'Paste text…'} />
        <ErrorBox error={err} />
        <div className="flex justify-end">
          <Button variant="primary" disabled={!title || !text.trim()} onClick={async () => {
            try { await api.createDoc({ kind, title, text }); setTitle(''); setText(''); onDone(); } catch (e) { setErr(String(e)); }
          }}><Plus className="h-4 w-4" /> Add</Button>
        </div>
      </div>
    </Card>
  );
}

const TRANSCRIPT_EXT = /\.(txt|md|json|srt|vtt)$/i;

function VoiceImport({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); }, []);

  const upload = async (list: FileList) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const files = Array.from(list).filter((f) => TRANSCRIPT_EXT.test(f.name) && !f.name.startsWith('.'));
      if (!files.length) throw new Error('No .txt / .json / .srt / .md transcripts found in that selection.');
      const total = { added: 0, updated: 0, skipped: 0 };
      let batch: { path: string; text: string; modified: string }[] = [], size = 0;
      const flush = async () => {
        if (!batch.length) return;
        const r = await api.importVoiceNotes(batch);
        total.added += r.added; total.updated += r.updated; total.skipped += r.skipped;
        batch = []; size = 0;
        setMsg(`Uploading… ${total.added + total.updated + total.skipped}/${files.length}`);
      };
      for (const f of files) {
        const text = await f.text();
        batch.push({ path: f.webkitRelativePath || f.name, text, modified: new Date(f.lastModified).toISOString() });
        size += text.length;
        if (size > 1_500_000) await flush(); // stay well under the 6 MB function payload limit
      }
      await flush();
      setMsg(`Done: ${total.added} new, ${total.updated} updated, ${total.skipped} unchanged or skipped.`);
      onDone();
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };

  return (
    <Card title={<span className="flex items-center gap-1.5"><FolderInput className="h-4 w-4" /> Sync iCloud voice-note transcripts</span>}>
      <p className="mb-3 text-sm text-zinc-500">
        Choose the <b>iCloud Drive → Transcripts</b> folder that your <b>audio-transcriber</b> writes to. Your browser reads the
        <code> .txt / .json / .srt / .md</code> files and uploads only the text. Run it again whenever you like (e.g. twice a year):
        new and edited notes are added, and unchanged ones are skipped.
      </p>
      <div className="flex flex-wrap gap-2">
        <input ref={folderRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
        <input ref={filesRef} type="file" multiple accept=".txt,.md,.json,.srt,.vtt" hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
        <Button variant="primary" loading={busy} onClick={() => folderRef.current?.click()}><FolderInput className="h-4 w-4" /> Choose folder…</Button>
        <Button disabled={busy} onClick={() => filesRef.current?.click()}><Upload className="h-4 w-4" /> Choose files…</Button>
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{msg}</p>}
      <div className="mt-2"><ErrorBox error={err} /></div>
    </Card>
  );
}

function StyleGuideCard({ notes, onDone }: { notes: LibraryDocSummary[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPicked(notes.map((n) => n.id)); }, [notes]);
  if (!notes.length) return null;
  const totalWords = notes.filter((n) => picked.includes(n.id)).reduce((a, n) => a + n.word_count, 0);
  return (
    <Card title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-indigo-500" /> Distil a voice style guide</span>}
      actions={<Button variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Set up'}</Button>}>
      <p className="text-sm text-zinc-500">
        Gemini reads your voice notes and writes a compact, dated style guide: your phrases, rhythm, humour, and what you'd never say,
        with verbatim excerpts. Add it to a suite's voice profile instead of hundreds of raw notes. It's cheaper per request, and you can
        compare guide versions after each refresh.
      </p>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2 text-xs">
            <button className="text-indigo-600" onClick={() => setPicked(notes.map((n) => n.id))}>All</button>
            <button className="text-indigo-600" onClick={() => setPicked([])}>None</button>
            <span className="text-zinc-500">{picked.length} notes · {totalWords.toLocaleString()} words</span>
          </div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-zinc-200 p-1 dark:border-zinc-800">
            {notes.map((n) => (
              <label key={n.id} className="flex items-center gap-2 px-2 py-0.5 text-sm">
                <input type="checkbox" checked={picked.includes(n.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, n.id] : picked.filter((x) => x !== n.id))} />
                <span className="flex-1 truncate">{n.title}</span><span className="text-xs text-zinc-500">{n.created_at?.slice(0, 10)}</span>
              </label>
            ))}
          </div>
          <ErrorBox error={err} />
          <div className="flex justify-end">
            <Button variant="primary" disabled={!picked.length} onClick={async () => {
              try { await api.styleGuide(picked); setOpen(false); onDone(); } catch (e) { setErr(String((e as Error).message)); }
            }}>Create style guide</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function PodcastFinder({ onImported }: { onImported: () => void }) {
  const [q, setQ] = useState('');
  const [shows, setShows] = useState<PodcastShow[] | null>(null);
  const [show, setShow] = useState<PodcastShow | null>(null);
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    setBusy('search'); setErr(null); setShow(null); setEps(null);
    try { setShows(await api.searchPodcasts(q)); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const open = async (s: PodcastShow) => {
    setShow(s); setEps(null); setBusy('eps'); setErr(null);
    try { setEps((await api.episodes(s.feed_url)).episodes); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const get = async (ep: Episode, mode: 'auto' | 'transcribe') => {
    if (mode === 'transcribe' && !confirm('No published transcript, so the audio will be downloaded and transcribed by Gemini (uses your GEMINI_API_KEY; a 1-hour episode is roughly 100k input tokens and takes a few minutes). Continue?')) return;
    setErr(null);
    try { await api.importEpisode(show!.feed_url, ep.guid, mode); onImported(); } catch (e) { setErr(String(e)); }
  };

  return (
    <Card title={<span className="flex items-center gap-1.5"><Search className="h-4 w-4" /> Find a podcast episode</span>}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) search(); }}>
        <input className="input flex-1" placeholder="Podcast name, e.g. Huberman Lab" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="primary" loading={busy === 'search'} type="submit">Search</Button>
      </form>
      <div className="mt-2"><ErrorBox error={err} /></div>
      {shows && !show && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {shows.length === 0 && <p className="text-sm text-zinc-500">No podcasts found.</p>}
          {shows.map((s) => (
            <button key={s.feed_url} onClick={() => open(s)} className="flex items-center gap-3 rounded-md border border-zinc-200 p-2 text-left hover:border-indigo-400 dark:border-zinc-800">
              {s.artwork && <img src={s.artwork} alt="" className="h-12 w-12 rounded" />}
              <div className="min-w-0"><div className="truncate text-sm font-medium">{s.name}</div><div className="truncate text-xs text-zinc-500">{s.author} · {s.episodes} episodes</div></div>
            </button>
          ))}
        </div>
      )}
      {show && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <button className="text-xs text-indigo-600" onClick={() => setShow(null)}>← all results</button>
            <b className="text-sm">{show.name}</b>
            <input className="input w-48 py-1 text-xs" placeholder="Filter episodes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {busy === 'eps' && <p className="text-sm text-zinc-500"><Loader2 className="inline h-4 w-4 animate-spin" /> Reading feed…</p>}
          <div className="max-h-[28rem] space-y-1 overflow-y-auto">
            {eps?.filter((e) => e.title.toLowerCase().includes(filter.toLowerCase())).map((ep) => (
              <div key={ep.guid} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{ep.title}</div>
                  <div className="text-xs text-zinc-500">{ep.published?.slice(0, 16)} {ep.duration && `· ${ep.duration}`}</div>
                </div>
                {ep.transcripts.length > 0
                  ? <><Badge color="green">transcript published</Badge><Button onClick={() => get(ep, 'auto')}><FileText className="h-4 w-4" /> Get transcript</Button></>
                  : <Button disabled={!ep.audio_url} onClick={() => get(ep, 'transcribe')}><AudioLines className="h-4 w-4" /> Transcribe with Gemini</Button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>('voice_note');
  const { data: docs, reload } = useAsync(() => api.library(), []);
  const processing = docs?.some((d) => d.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [processing, reload]);
  const del = async (id: string) => { await api.deleteDoc(id); reload(); };
  const of = (k: DocKind) => docs?.filter((d) => d.kind === k) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">Library</h1>
      <p className="text-sm text-zinc-500">Your personal context. Voice notes become a <b>voice profile</b> or background that models see. Podcast transcripts and documents get attached to test cases. Everything is stored in your own app database, behind your password.</p>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'voice_note', label: <span className="flex items-center gap-1.5"><Mic className="h-4 w-4" /> Voice notes ({of('voice_note').length})</span> },
        { id: 'podcast', label: <span className="flex items-center gap-1.5"><AudioLines className="h-4 w-4" /> Podcasts ({of('podcast').length})</span> },
        { id: 'document', label: <span className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> Documents ({of('document').length})</span> },
      ]} />
      {tab === 'voice_note' && <>
        <VoiceImport onDone={reload} />
        <StyleGuideCard notes={of('voice_note').filter((d) => d.status === 'ready')} onDone={() => { setTab('document'); reload(); }} />
        <PasteCard kind="voice_note" onDone={reload} />
        <DocList docs={of('voice_note')} onDelete={del} />
      </>}
      {tab === 'podcast' && <>
        <PodcastFinder onImported={reload} />
        <DocList docs={of('podcast')} onDelete={del} />
        <PasteCard kind="podcast" onDone={reload} />
      </>}
      {tab === 'document' && <>
        <PasteCard kind="document" onDone={reload} />
        <DocList docs={of('document')} onDelete={del} />
      </>}
      <p className="text-xs text-zinc-400">Tip: open a podcast to rename speakers (e.g. SPEAKER_00 → the host's name) so summaries can attribute who said what. <a className="underline" href="#/suites">Back to suites</a></p>
    </div>
  );
}
