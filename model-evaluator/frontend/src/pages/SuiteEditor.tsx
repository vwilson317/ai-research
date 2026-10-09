import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { CHECK_TYPES, CRITERIA_PRESETS } from '../presets';
import type { AutoCheck, Criterion, Suite, TestCase } from '../types';
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

function CaseRow({ c, index, onChange, onDelete }: { c: TestCase; index: number; onChange: (c: TestCase) => void; onDelete: () => void }) {
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
    </div>
  );
}

export default function SuiteEditor({ id }: { id: string }) {
  const { data, error } = useAsync(() => api.suite(id), [id]);
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
          <Button variant="ghost" onClick={() => setBulk('')}>Bulk add</Button>
          <Button variant="ghost" onClick={() => addCases([''])}><Plus className="h-4 w-4" /> Case</Button>
        </>}>
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
            <CaseRow key={i} c={c} index={i}
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
