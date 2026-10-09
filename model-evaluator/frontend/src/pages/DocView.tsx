import { useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api';
import { go } from '../router';
import type { LibraryDoc } from '../types';
import { Badge, Button, Card, ErrorBox } from '../components/ui';
import { Dialogue } from '../components/Dialogue';

export default function DocView({ id }: { id: string }) {
  const [doc, setDoc] = useState<LibraryDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', text: '' });
  const [names, setNames] = useState<Record<string, string>>({});

  const load = () => api.doc(id).then((d) => { setDoc(d); setDraft({ title: d.title, text: d.text }); }).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (doc?.status !== 'processing') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [doc?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return err ? <ErrorBox error={err} /> : null;
  const speakers = [...new Set((doc.segments ?? []).map((s) => s.speaker).filter(Boolean))] as string[];
  const meta = doc.meta as Record<string, string | boolean | undefined>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <a href="#/library" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Library</a>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{doc.kind.replace('_', ' ')}</Badge>
            <Badge>{doc.word_count.toLocaleString()} words</Badge>
            {doc.created_at && <Badge>{doc.created_at.slice(0, 10)}</Badge>}
            {meta.transcript_source === 'gemini' && <Badge color="amber">transcribed by {String(meta.transcribed_by)}</Badge>}
            {meta.transcript_source === 'feed' && <Badge color="green">published transcript</Badge>}
            {meta.truncated && <Badge color="red">transcript truncated (hit output limit)</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" /> {editing ? 'Cancel' : 'Edit'}</Button>
          <Button variant="danger" onClick={async () => { if (confirm('Delete this document?')) { await api.deleteDoc(id); go('/library'); } }}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <ErrorBox error={err || doc.error} />
      {doc.status === 'processing' && <Card><p className="text-sm text-zinc-500">Working on it: {String(meta.step ?? 'processing')}… this page refreshes automatically.</p></Card>}

      {editing ? (
        <Card title="Edit">
          <input className="input mb-2" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea className="input mono text-xs" rows={20} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <div className="mt-2 flex justify-end">
            <Button variant="primary" onClick={async () => {
              try { await api.updateDoc(id, { kind: doc.kind, ...draft }); setEditing(false); load(); } catch (e) { setErr(String(e)); }
            }}>Save</Button>
          </div>
        </Card>
      ) : (
        <>
          {speakers.length > 0 && (
            <Card title="Speakers" actions={<span className="text-xs text-zinc-500">Rename generic labels so summaries can say who said what</span>}>
              <div className="grid gap-2 sm:grid-cols-2">
                {speakers.map((sp) => (
                  <label key={sp} className="flex items-center gap-2 text-sm">
                    <span className="mono w-32 truncate text-xs text-zinc-500">{sp}</span>
                    <input className="input" placeholder="Real name" value={names[sp] ?? ''} onChange={(e) => setNames({ ...names, [sp]: e.target.value })} />
                  </label>
                ))}
              </div>
              <div className="mt-2 flex justify-end">
                <Button variant="primary" disabled={!Object.values(names).some(Boolean)} onClick={async () => {
                  try { setDoc(await api.renameSpeakers(id, Object.fromEntries(Object.entries(names).filter(([, v]) => v)))); setNames({}); } catch (e) { setErr(String(e)); }
                }}>Apply names</Button>
              </div>
            </Card>
          )}
          <Card title={doc.segments ? 'Conversation' : 'Text'}>
            {doc.segments ? <Dialogue segments={doc.segments} maxHeight="70vh" /> : <div className="whitespace-pre-wrap text-sm">{doc.text}</div>}
          </Card>
        </>
      )}
    </div>
  );
}
