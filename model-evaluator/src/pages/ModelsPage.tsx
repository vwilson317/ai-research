import { useState } from 'react';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { api } from '../api';
import { PROVIDERS } from '../presets';
import type { ModelConfig, Provider } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Field, useAsync } from '../components/ui';

const BLANK: ModelConfig = {
  label: '', provider: 'google', model: '', base_url: null, api_key_env: null, temperature: 0.7, max_tokens: 2048,
  top_p: null, system_prompt: null, price_input_per_mtok: 0, price_output_per_mtok: 0,
};

const num = (v: string) => (v === '' ? null : Number(v));

export default function ModelsPage() {
  const { data: models, error, reload } = useAsync(api.models, []);
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, { loading?: boolean; ok?: boolean; msg?: string }>>({});

  const save = async () => {
    if (!editing) return;
    setSaving(true); setErr(null);
    try {
      if (editing.id) await api.updateModel(editing.id, editing); else await api.createModel(editing);
      setEditing(null); reload();
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };

  const test = async (m: ModelConfig) => {
    setTests((t) => ({ ...t, [m.id!]: { loading: true } }));
    const r = await api.testModel(m.id!).catch((e) => ({ ok: false, error: String(e), output: undefined }));
    setTests((t) => ({ ...t, [m.id!]: { ok: r.ok, msg: r.ok ? r.output : r.error } }));
  };

  const set = <K extends keyof ModelConfig>(k: K, v: ModelConfig[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));
  const prov = PROVIDERS.find((p) => p.value === editing?.provider);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Models</h1>
        <Button variant="primary" onClick={() => setEditing({ ...BLANK })}><Plus className="h-4 w-4" /> Add model</Button>
      </div>
      <p className="text-sm text-zinc-500">The contestants. Each configuration (model + parameters) is a separate entry, so you can also compare the same model at different temperatures or with different system prompts.</p>
      <ErrorBox error={error} />

      {editing && (
        <Card title={editing.id ? `Edit ${editing.label}` : 'New model'}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Display name (hidden during blind review)">
              <input className="input" value={editing.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Gemini 3.8 Flash @ t=0" />
            </Field>
            <Field label="Provider">
              <select className="input" value={editing.provider} onChange={(e) => set('provider', e.target.value as Provider)}>
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Model id" hint={`e.g. ${prov?.example}`}>
              <input className="input mono" value={editing.model} onChange={(e) => set('model', e.target.value)} />
            </Field>
            {editing.provider === 'openai_compatible' && (
              <Field label="Base URL" hint="https://openrouter.ai/api/v1 · http://localhost:11434/v1 (Ollama)">
                <input className="input mono" value={editing.base_url ?? ''} onChange={(e) => set('base_url', e.target.value || null)} />
              </Field>
            )}
            <Field label="API key name (optional override)" hint={`Defaults to ${prov?.key || 'none'}. Set this to use a different key, e.g. GROQ_API_KEY.`}>
              <input className="input mono" value={editing.api_key_env ?? ''} onChange={(e) => set('api_key_env', e.target.value || null)} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Temperature" hint="blank = provider default">
                <input className="input" type="number" step="0.1" min="0" max="2" value={editing.temperature ?? ''} onChange={(e) => set('temperature', num(e.target.value))} />
              </Field>
              <Field label="Top-p">
                <input className="input" type="number" step="0.05" min="0" max="1" value={editing.top_p ?? ''} onChange={(e) => set('top_p', num(e.target.value))} />
              </Field>
              <Field label="Max tokens">
                <input className="input" type="number" min="1" value={editing.max_tokens} onChange={(e) => set('max_tokens', Number(e.target.value) || 1)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="$ / 1M input tokens">
                <input className="input" type="number" step="0.01" min="0" value={editing.price_input_per_mtok} onChange={(e) => set('price_input_per_mtok', Number(e.target.value) || 0)} />
              </Field>
              <Field label="$ / 1M output tokens">
                <input className="input" type="number" step="0.01" min="0" value={editing.price_output_per_mtok} onChange={(e) => set('price_output_per_mtok', Number(e.target.value) || 0)} />
              </Field>
            </div>
            <Field label="Extra system prompt (appended to the suite's)" className="md:col-span-2">
              <textarea className="input" rows={2} value={editing.system_prompt ?? ''} onChange={(e) => set('system_prompt', e.target.value || null)} />
            </Field>
          </div>
          <ErrorBox error={err} />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!editing.label || !editing.model} onClick={save}>Save</Button>
          </div>
        </Card>
      )}

      {models && models.length === 0 && <Empty>No models yet.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {models?.map((m) => (
          <Card key={m.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{m.label}</div>
                <div className="mono truncate text-xs text-zinc-500">{m.provider} · {m.model}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge>temp {m.temperature ?? 'default'}</Badge>
                  <Badge>max {m.max_tokens}</Badge>
                  {(m.price_input_per_mtok > 0 || m.price_output_per_mtok > 0) && <Badge>${m.price_input_per_mtok}/${m.price_output_per_mtok} per M</Badge>}
                  {m.system_prompt && <Badge color="indigo">custom system prompt</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" title="Send a test request" onClick={() => test(m)} loading={tests[m.id!]?.loading}><Zap className="h-4 w-4" /></Button>
                <Button variant="ghost" title="Edit" onClick={() => setEditing({ ...m })}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" title="Delete" onClick={async () => { if (confirm(`Delete ${m.label}?`)) { await api.deleteModel(m.id!); reload(); } }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {tests[m.id!] && !tests[m.id!].loading && (
              <div className={`mt-2 rounded px-2 py-1 text-xs ${tests[m.id!].ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
                {tests[m.id!].ok ? '✓ ' : '✗ '}{tests[m.id!].msg}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
