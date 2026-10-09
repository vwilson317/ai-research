import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Shuffle, Sparkles } from 'lucide-react';
import { api } from '../api';
import { go } from '../router';
import { PROVIDERS } from '../presets';
import type { JudgeConfig } from '../types';
import { Badge, Button, Card, ErrorBox, Field, useAsync } from '../components/ui';

export default function NewRunPage() {
  const { data } = useAsync(() => Promise.all([api.suites(), api.models(), api.settings()]), []);
  const [suites, models, settings] = data ?? [[], [], null];
  const [suiteId, setSuiteId] = useState('');
  const [count, setCount] = useState(2);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [samples, setSamples] = useState(1);
  const [concurrency, setConcurrency] = useState(4);
  const [blindMode, setBlindMode] = useState<'consistent' | 'per_case'>('consistent');
  const [judge, setJudge] = useState<JudgeConfig>({ enabled: true, model: 'gemini-3.8-flash', mode: 'individual', include_reference: true, temperature: 0, auto_run: true });
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => { if (!suiteId && suites.length) setSuiteId(suites[0].id!); }, [suites, suiteId]);
  useEffect(() => {
    setPicked((p) => {
      const next = p.slice(0, count);
      const unused = models.map((m) => m.id!).filter((id) => !next.includes(id));
      while (next.length < count) next.push(unused.shift() ?? '');
      return next;
    });
  }, [count, models]);

  const suite = suites.find((s) => s.id === suiteId);
  const chosen = picked.map((id) => models.find((m) => m.id === id)).filter(Boolean);
  const dupes = new Set(picked.filter((id, i) => id && picked.indexOf(id) !== i));
  const missingKeys = useMemo(() => {
    const out = new Set<string>();
    for (const m of chosen) {
      const key = m!.api_key_env || PROVIDERS.find((p) => p.value === m!.provider)?.key;
      if (key && m!.provider !== 'openai_compatible' && !settings?.keys[key]?.set) out.add(key);
    }
    if (judge.enabled && !judge.model.startsWith('mock') && !settings?.keys.GEMINI_API_KEY?.set) out.add('GEMINI_API_KEY (judge)');
    return [...out];
  }, [chosen, settings, judge]);

  const aiCriteria = suite?.criteria.filter((c) => c.graded_by !== 'human').length ?? 0;
  const humanCriteria = suite?.criteria.filter((c) => c.graded_by !== 'ai').length ?? 0;
  const gens = (suite?.cases.length ?? 0) * samples * count;
  const judgeCalls = judge.enabled && aiCriteria ? (judge.mode === 'individual' ? gens : (suite?.cases.length ?? 0) * samples) : 0;
  const canStart = suite && suite.cases.length > 0 && suite.criteria.length > 0 && picked.every(Boolean) && dupes.size === 0;

  const start = async () => {
    setStarting(true); setErr(null);
    try {
      const run = await api.createRun({ name: name || undefined, suite_id: suiteId, model_ids: picked, samples_per_case: samples, concurrency, blind_mode: blindMode, judge });
      go(`/runs/${run.id}`);
    } catch (e) { setErr(String(e)); setStarting(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">New evaluation run</h1>

      <Card title="1 · What to evaluate">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Eval suite">
            <select className="input" value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
              {suites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.cases.length} cases)</option>)}
            </select>
          </Field>
          <Field label="Run name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={suite?.name} /></Field>
        </div>
        {suite && (
          <div className="mt-2 flex flex-wrap gap-1">
            {suite.criteria.map((c) => <Badge key={c.id} title={c.description}>{c.name} ×{c.weight}</Badge>)}
            {suite.criteria.length === 0 && <Badge color="red">Suite has no criteria — add some first</Badge>}
          </div>
        )}
      </Card>

      <Card title="2 · Contestants" actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Number of models</span>
          <Button variant="ghost" disabled={count <= 1} onClick={() => setCount(count - 1)}><Minus className="h-4 w-4" /></Button>
          <span className="w-5 text-center font-semibold">{count}</span>
          <Button variant="ghost" disabled={count >= 8} onClick={() => setCount(count + 1)}><Plus className="h-4 w-4" /></Button>
        </div>}>
        <div className="grid gap-2 md:grid-cols-2">
          {picked.map((id, i) => (
            <Field key={i} label={`Contestant ${i + 1}`}>
              <select className={`input ${dupes.has(id) ? 'border-red-400' : ''}`} value={id} onChange={(e) => setPicked(picked.map((p, j) => (j === i ? e.target.value : p)))}>
                <option value="">Select a model…</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.provider}/{m.model}</option>)}
              </select>
            </Field>
          ))}
        </div>
        <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500"><Shuffle className="h-3.5 w-3.5" /> Contestants are randomly assigned to anonymous labels (Model A, B, …) when the run starts. You won't see which is which until you reveal.</p>
        {dupes.size > 0 && <p className="mt-1 text-xs text-red-600">The same model is selected twice. To compare settings, create a second model config.</p>}
        {models.length === 0 && <p className="text-sm text-zinc-500">No models — <a className="text-indigo-600" href="#/models">add some</a>.</p>}
      </Card>

      <Card title="3 · Run settings">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Samples per case" hint="> 1 measures consistency (score variance)">
            <input className="input" type="number" min={1} max={10} value={samples} onChange={(e) => setSamples(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Parallel requests">
            <input className="input" type="number" min={1} max={32} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Blinding" hint={blindMode === 'consistent' ? 'Same letter for a model across all cases.' : 'Re-labelled per case: you can’t track a model’s style between cases.'}>
            <select className="input" value={blindMode} onChange={(e) => setBlindMode(e.target.value as 'consistent' | 'per_case')}>
              <option value="consistent">Consistent labels (Model A, B…)</option>
              <option value="per_case">Strict — shuffle labels per case</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-indigo-500" /> 4 · AI judge</span>}
        actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={judge.enabled} onChange={(e) => setJudge({ ...judge, enabled: e.target.checked })} /> Enabled</label>}>
        <fieldset disabled={!judge.enabled} className="grid gap-3 disabled:opacity-50 md:grid-cols-2">
          <Field label="Judge model (Gemini)" hint="gemini-3.8-flash is the newest GA Gemini; 3.1 Pro is stronger but preview-only.">
            <input className="input mono" list="judge-models" value={judge.model} onChange={(e) => setJudge({ ...judge, model: e.target.value })} />
            <datalist id="judge-models">{settings?.judge_models.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label="Judging mode" hint={judge.mode === 'individual' ? 'Each output graded alone — least position bias.' : 'All outputs for a case shown together (shuffled) — better calibrated relative scores.'}>
            <select className="input" value={judge.mode} onChange={(e) => setJudge({ ...judge, mode: e.target.value as JudgeConfig['mode'] })}>
              <option value="individual">Individual (pointwise)</option>
              <option value="comparative">Comparative (all responses at once)</option>
            </select>
          </Field>
          <Field label="Judge temperature"><input className="input" type="number" step="0.1" min={0} max={2} value={judge.temperature} onChange={(e) => setJudge({ ...judge, temperature: Number(e.target.value) })} /></Field>
          <div className="space-y-2 pt-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={judge.include_reference} onChange={(e) => setJudge({ ...judge, include_reference: e.target.checked })} /> Show reference answers to the judge</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={judge.auto_run} onChange={(e) => setJudge({ ...judge, auto_run: e.target.checked })} /> Judge automatically after generation</label>
          </div>
        </fieldset>
        <p className="mt-3 text-xs text-zinc-500">The judge never sees model names. AI scores stay hidden in the review screen until you've scored a case yourself, so they don't anchor you. After a run, you can also ask the judge to audit the eval itself (case quality, rubric clarity, human-vs-AI agreement).</p>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            <b>{gens}</b> generations · <b>{judgeCalls}</b> judge calls · <b>{gens * humanCriteria}</b> human ratings to give
          </div>
          <Button variant="primary" loading={starting} disabled={!canStart} onClick={start}>Start run</Button>
        </div>
        {missingKeys.length > 0 && <p className="mt-2 text-xs text-amber-600">Missing API keys: {missingKeys.join(', ')} — <a className="underline" href="#/settings">add them</a> or those calls will fail.</p>}
        <div className="mt-2"><ErrorBox error={err} /></div>
      </Card>
    </div>
  );
}
