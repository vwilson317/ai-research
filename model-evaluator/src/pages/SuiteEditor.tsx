import { useEffect, useState } from 'react';
import { ArrowLeft, Mic, Paperclip, Plus, Trash2, User, X } from 'lucide-react';
import { api } from '../api';
import { CHECK_TYPES, CRITERIA_PRESETS } from '../presets';
import type { AutoCheck, Criterion, LibraryDocSummary, Suite, SuiteContext, TestCase } from '../types';
import { Badge, Button, Card, ErrorBox, Field, useAsync } from '../components/ui';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'criterion';

function uniqueId(base: string, taken: string[]) {
  let id = base, i = 2;
  while (taken.includes(id)) id = `${base}_${i++}`;
  return id;
}

function ChecksEditor({ checks, onChange }: { checks: AutoCheck[]; onChange: (c: AutoCheck[]) => void }) {
  return (
    <div className="space-y-1.5">
      {checks.map((c, i) => {
        const meta = CHECK_TYPES.find((t) => t.type === c.type)!;
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <select className="input w-auto" value={c.type} onChange={(e) => onChange(checks.map((x, j) => (j === i ? { ...x, type: e.target.value as AutoCheck['type'] } : x)))}>
              {CHECK_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
            {meta.needsValue && (
              <input className="input mono min-w-[8rem] flex-1" placeholder={meta.hint ?? 'value'} value={c.value ?? ''}
                onChange={(e) => onChange(checks.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            )}
            {['contains', 'not_contains', 'exact', 'starts_with', 'regex', 'matches_reference'].includes(c.type) && (
              <label className="flex items-center gap-1 text-xs text-zinc-500">
                <input type="checkbox" checked={!!c.case_sensitive} onChange={(e) => onChange(checks.map((x, j) => (j === i ? { ...x, case_sensitive: e.target.checked } : x)))} />
                case-sensitive
              </label>
            )}
            <Button variant="ghost" onClick={() => onChange(checks.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
          </div>
        );
      })}
      <Button variant="ghost" className="text-xs" onClick={() => onChange([...checks, { type: 'contains', value: '' }])}><Plus className="h-3.5 w-3.5" /> Add check</Button>
    </div>
  );
}

function CriterionRow({ c, onChange, onDelete }: { c: Criterion; onChange: (c: Criterion) => void; onDelete: () => void }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="grid gap-2 md:grid-cols-[1fr_120px_110px_90px_130px_auto]">
        <Field label="Name"><input className="input" value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value })} /></Field>
        <Field label="Id"><input className="input mono" value={c.id} onChange={(e) => onChange({ ...c, id: slug(e.target.value) })} /></Field>
        <Field label="Scale">
          <select className="input" value={c.scale_max} onChange={(e) => onChange({ ...c, scale_max: Number(e.target.value) })}>
            <option value={1}>Pass / fail</option>
            {[3, 4, 5, 7, 10].map((n) => <option key={n} value={n}>1 – {n}</option>)}
          </select>
        </Field>
        <Field label="Weight"><input className="input" type="number" step="0.5" min="0" value={c.weight} onChange={(e) => onChange({ ...c, weight: Number(e.target.value) })} /></Field>
        <Field label="Graded by">
          <select className="input" value={c.graded_by} onChange={(e) => onChange({ ...c, graded_by: e.target.value as Criterion['graded_by'] })}>
            <option value="both">Human + AI judge</option>
            <option value="human">Human only</option>
            <option value="ai">AI judge only</option>
          </select>
        </Field>
        <div className="flex items-end"><Button variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button></div>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Field label="Description (what it measures)"><textarea className="input" rows={2} value={c.description} onChange={(e) => onChange({ ...c, description: e.target.value })} /></Field>
        <Field label="Rubric (what each score means — shown to you and the judge)"><textarea className="input mono text-xs" rows={2} value={c.rubric} onChange={(e) => onChange({ ...c, rubric: e.target.value })} /></Field>
      </div>
    </div>
  );
}

function CaseRow({ c, index, onChange, onDelete, docs, defaultInput }: {
  c: TestCase; index: number; onChange: (c: TestCase) => void; onDelete: () => void; docs: LibraryDocSummary[]; defaultInput?: string;
}) {
  const attached = c.context_doc_ids ?? [];
  const source = c.source_doc_id ? docs.find((d) => d.id === c.source_doc_id) : null;
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-zinc-400">#{index + 1}</span>
          <input className="input mono w-28 py-0.5 text-xs" value={c.id} onChange={(e) => onChange({ ...c, id: e.target.value.replace(/\s/g, '_') })} />
        </div>
        <Button variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Field label="Prompt / input"><textarea className="input" rows={4} value={c.input} onChange={(e) => onChange({ ...c, input: e.target.value })} /></Field>
        <Field label="Reference answer or grading notes (optional)"><textarea className="input" rows={4} value={c.reference ?? ''} onChange={(e) => onChange({ ...c, reference: e.target.value || null })} /></Field>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[200px_1fr]">
        <Field label="Tags (comma-separated)">
          <input className="input" value={c.tags.join(', ')} onChange={(e) => onChange({ ...c, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
        </Field>
        <div><span className="label">Automatic checks for this case</span><ChecksEditor checks={c.checks} onChange={(checks) => onChange({ ...c, checks })} /></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="label mb-0 flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" /> Attached material:</span>
        {attached.map((id) => {
          const d = docs.find((x) => x.id === id);
          return (
            <Badge key={id} color={d ? 'indigo' : 'red'}>
              <a href={`#/library/${id}`}>{d ? d.title : 'missing document'}</a>
              <button onClick={() => onChange({ ...c, context_doc_ids: attached.filter((x) => x !== id) })}><X className="h-3 w-3" /></button>
            </Badge>
          );
        })}
        <select className="input w-auto max-w-xs py-0.5 text-xs" value="" onChange={(e) => e.target.value && onChange({
          ...c, context_doc_ids: [...attached, e.target.value],
          // attaching an episode to an empty case reuses the suite's instructions (e.g. the summary prompt)
          input: c.input.trim() ? c.input : (defaultInput ?? ''),
        })}>
          <option value="">+ attach transcript / document…</option>
          {(['podcast', 'document', 'voice_note'] as const).map((k) => (
            <optgroup key={k} label={k === 'podcast' ? 'Podcasts' : k === 'document' ? 'Documents' : 'Voice notes'}>
              {docs.filter((d) => d.kind === k && d.status === 'ready' && !attached.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </optgroup>
          ))}
        </select>
        {source && <Badge title="This case's input came from this voice note; it is left out of the voice profile for this case."><Mic className="h-3 w-3" /> from: {source.title}</Badge>}
      </div>
    </div>
  );
}

const DEFAULT_CTX: SuiteContext = { doc_ids: [], role: 'voice', max_chars: 24000, share_with_judge: true };

function ContextCard({ ctx, docs, onChange }: { ctx: SuiteContext; docs: LibraryDocSummary[]; onChange: (c: SuiteContext) => void }) {
  const [filter, setFilter] = useState('');
  const notes = docs.filter((d) => d.kind !== 'podcast' && d.status === 'ready');
  const selected = new Set(ctx.doc_ids);
  const chars = notes.filter((d) => selected.has(d.id)).reduce((a, d) => a + d.word_count * 6, 0);
  const shown = notes.filter((d) => !filter || d.title.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: string) => onChange({ ...ctx, doc_ids: selected.has(id) ? ctx.doc_ids.filter((x) => x !== id) : [...ctx.doc_ids, id] });
  return (
    <Card title={<span className="flex items-center gap-1.5"><User className="h-4 w-4" /> Personal context <span className="font-normal text-zinc-500">· {ctx.doc_ids.length} selected</span></span>}
      actions={<a href="#/library" className="text-xs text-indigo-600">Manage library →</a>}>
      <p className="mb-3 text-sm text-zinc-500">Your voice notes or writing, given to every model (and the judge) as context. As a <b>voice profile</b> they teach the model how you talk. As <b>background</b> they tell it about your life. Newest notes are used first, up to the size budget.</p>
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <Field label="Use as">
          <select className="input" value={ctx.role} onChange={(e) => onChange({ ...ctx, role: e.target.value as SuiteContext['role'] })}>
            <option value="voice">Voice profile (match my tone)</option>
            <option value="background">Background about me</option>
          </select>
        </Field>
        <Field label="Size budget (characters)" hint={`≈ ${Math.round(ctx.max_chars / 4).toLocaleString()} tokens per request · selected ≈ ${chars.toLocaleString()} chars`}>
          <input className="input" type="number" min={500} step={1000} value={ctx.max_chars} onChange={(e) => onChange({ ...ctx, max_chars: Math.max(500, Number(e.target.value) || 500) })} />
        </Field>
        <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={ctx.share_with_judge} onChange={(e) => onChange({ ...ctx, share_with_judge: e.target.checked })} /> Show to the AI judge (needed to grade tone)</label>
      </div>
      {notes.length === 0 ? <p className="text-sm text-zinc-500">No voice notes or documents yet. <a className="text-indigo-600" href="#/library">Sync your iCloud transcripts →</a></p> : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            <input className="input w-48 py-1 text-xs" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Button variant="ghost" className="text-xs" onClick={() => onChange({ ...ctx, doc_ids: [...new Set([...ctx.doc_ids, ...shown.map((d) => d.id)])] })}>Select all shown</Button>
            <Button variant="ghost" className="text-xs" onClick={() => onChange({ ...ctx, doc_ids: [] })}>Clear</Button>
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-zinc-200 p-1 dark:border-zinc-800">
            {shown.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                <span className="flex-1 truncate">{d.title}</span>
                {Boolean(d.meta?.style_guide) && <Badge color="indigo">style guide</Badge>}
                <span className="text-xs text-zinc-500">{d.created_at?.slice(0, 10)} · {d.word_count} w</span>
              </label>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export default function SuiteEditor({ id }: { id: string }) {
  const { data, error } = useAsync(() => api.suite(id), [id]);
  const { data: docs } = useAsync(() => api.library(), []);
  const [pickNotes, setPickNotes] = useState<string[] | null>(null);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => { if (data) setSuite(data); }, [data]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (error) return <ErrorBox error={error} />;
  if (!suite) return null;

  const update = (patch: Partial<Suite>) => { setSuite({ ...suite, ...patch }); setDirty(true); };
  const save = async () => {
    setSaving(true); setErr(null);
    try { setSuite(await api.updateSuite(id, suite)); setDirty(false); } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };
  const addCases = (inputs: string[]) => {
    const taken = suite.cases.map((c) => c.id);
    const added = inputs.map((input) => {
      const cid = uniqueId(`c${taken.length + 1}`, taken);
      taken.push(cid);
      return { id: cid, input, reference: null, tags: [], checks: [] } as TestCase;
    });
    update({ cases: [...suite.cases, ...added] });
  };
  const parseBulk = (text: string) => {
    const t = text.trim();
    if (!t) return;
    // JSONL with {"input", "reference", "tags"} or plain blocks separated by blank lines
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const rows = t.startsWith('[') ? JSON.parse(t) : t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const taken = suite.cases.map((c) => c.id);
        const added: TestCase[] = rows.map((r: Partial<TestCase> & { prompt?: string; expected?: string }) => {
          const cid = uniqueId(r.id || `c${taken.length + 1}`, taken); taken.push(cid);
          return { id: cid, input: r.input ?? r.prompt ?? '', reference: r.reference ?? r.expected ?? null, tags: r.tags ?? [], checks: r.checks ?? [] };
        });
        update({ cases: [...suite.cases, ...added] });
      } catch (e) { setErr(`Could not parse JSON: ${e}`); return; }
    } else {
      addCases(t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean));
    }
    setBulk(null);
  };

  const ctx = suite.context ?? DEFAULT_CTX;
  const voiceNotes = (docs ?? []).filter((d) => d.kind === 'voice_note' && d.status === 'ready');
  const casesFromNotes = async (ids: string[]) => {
    const taken = suite.cases.map((c) => c.id);
    const added: TestCase[] = [];
    for (const did of ids) {
      const d = await api.doc(did);
      const cid = uniqueId(`vn${taken.length + 1}`, taken); taken.push(cid);
      added.push({ id: cid, input: d.text, reference: null, tags: ['my-voice-note'], checks: [], context_doc_ids: [], source_doc_id: d.id });
    }
    update({ cases: [...suite.cases, ...added] });
    setPickNotes(null);
  };
  const unusedPresets = CRITERIA_PRESETS.filter((p) => !suite.criteria.some((c) => c.id === p.id));
  const totalWeight = suite.criteria.reduce((a, c) => a + c.weight, 0);
  const shownCases = suite.cases
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !filter || `${c.input} ${c.tags.join(' ')} ${c.id}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24">
      <a href="#/suites" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Suites</a>
      <ErrorBox error={err} />

      <Card title="Basics">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name"><input className="input" value={suite.name} onChange={(e) => update({ name: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={suite.description} onChange={(e) => update({ description: e.target.value })} /></Field>
          <Field label="System prompt (sent to every model)" className="md:col-span-2">
            <textarea className="input" rows={3} value={suite.system_prompt} onChange={(e) => update({ system_prompt: e.target.value })} />
          </Field>
        </div>
      </Card>

      <ContextCard ctx={ctx} docs={docs ?? []} onChange={(context) => update({ context })} />

      <Card title={<>Scoring criteria <span className="font-normal text-zinc-500">· total weight {totalWeight}</span></>}
        actions={<>
          {unusedPresets.length > 0 && (
            <select className="input w-auto py-1 text-xs" value="" onChange={(e) => {
              const p = CRITERIA_PRESETS.find((x) => x.id === e.target.value);
              if (p) update({ criteria: [...suite.criteria, { ...p }] });
            }}>
              <option value="">+ Add from library…</option>
              {unusedPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <Button variant="ghost" onClick={() => {
            const cid = uniqueId('custom', suite.criteria.map((c) => c.id));
            update({ criteria: [...suite.criteria, { id: cid, name: 'Custom criterion', description: '', rubric: '', scale_max: 5, weight: 1, graded_by: 'both' }] });
          }}><Plus className="h-4 w-4" /> Custom</Button>
        </>}>
        <div className="space-y-2">
          {suite.criteria.length === 0 && <p className="text-sm text-zinc-500">Add at least one criterion. Each output gets a score per criterion; the overall score is the weighted average, normalised to 0–100.</p>}
          {suite.criteria.map((c, i) => (
            <CriterionRow key={i} c={c}
              onChange={(nc) => update({ criteria: suite.criteria.map((x, j) => (j === i ? nc : x)) })}
              onDelete={() => update({ criteria: suite.criteria.filter((_, j) => j !== i) })} />
          ))}
        </div>
      </Card>

      <Card title="Global automatic checks" actions={<span className="text-xs text-zinc-500">Applied to every output — objective pass/fail signals alongside the graded scores</span>}>
        <ChecksEditor checks={suite.global_checks} onChange={(global_checks) => update({ global_checks })} />
      </Card>

      <Card title={<>Test cases <Badge>{suite.cases.length}</Badge></>}
        actions={<>
          <input className="input w-40 py-1 text-xs" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {voiceNotes.length > 0 && <Button variant="ghost" onClick={() => setPickNotes([])}><Mic className="h-4 w-4" /> From voice notes</Button>}
          <Button variant="ghost" onClick={() => setBulk('')}>Bulk add</Button>
          <Button variant="ghost" onClick={() => addCases([''])}><Plus className="h-4 w-4" /> Case</Button>
        </>}>
        {pickNotes !== null && (
          <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
            <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">Each selected voice note becomes a test case, with its raw transcript as the input. Notes used as cases are automatically left out of the voice profile for that case, so the model can't copy the answer.</p>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {voiceNotes.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={pickNotes.includes(d.id)} onChange={(e) => setPickNotes(e.target.checked ? [...pickNotes, d.id] : pickNotes.filter((x) => x !== d.id))} />
                  <span className="flex-1 truncate">{d.title}</span><span className="text-xs text-zinc-500">{d.word_count} words</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button onClick={() => setPickNotes(null)}>Cancel</Button>
              <Button variant="primary" disabled={!pickNotes.length} onClick={() => casesFromNotes(pickNotes)}>Add {pickNotes.length} case(s)</Button>
            </div>
          </div>
        )}
        {bulk !== null && (
          <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
            <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">Paste prompts separated by blank lines, or JSONL / a JSON array of <code>{'{"input", "reference", "tags"}'}</code> objects.</p>
            <textarea className="input mono text-xs" rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <div className="mt-2 flex justify-end gap-2">
              <Button onClick={() => setBulk(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => parseBulk(bulk)}>Add cases</Button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {shownCases.map(({ c, i }) => (
            <CaseRow key={i} c={c} index={i} docs={docs ?? []} defaultInput={suite.cases.find((x) => x.input.trim() && x.context_doc_ids?.length)?.input}
              onChange={(nc) => update({ cases: suite.cases.map((x, j) => (j === i ? nc : x)) })}
              onDelete={() => update({ cases: suite.cases.filter((_, j) => j !== i) })} />
          ))}
        </div>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-zinc-200 bg-white/90 px-4 py-2 backdrop-blur md:left-52 dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>Save suite</Button>
        </div>
      </div>
    </div>
  );
}
