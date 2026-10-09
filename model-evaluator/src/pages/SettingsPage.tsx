import { useState } from 'react';
import { api } from '../api';
import { Badge, Button, Card, ErrorBox, useAsync } from '../components/ui';

const DESCRIPTIONS: Record<string, string> = {
  GEMINI_API_KEY: 'Gemini models and the AI judge (required for judging). Get one at aistudio.google.com.',
  ANTHROPIC_API_KEY: 'Claude models.',
  OPENAI_API_KEY: 'OpenAI models.',
  OPENROUTER_API_KEY: 'Default key for OpenAI-compatible endpoints (OpenRouter, Groq, Together…). Ollama needs none.',
};

export default function SettingsPage() {
  const { data, error, setData } = useAsync(api.settings, []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (keys: Record<string, string | null>) => {
    setSaving(true); setErr(null);
    try { setData(await api.saveKeys(keys)); setDraft({}); } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">API keys</h1>
      <p className="text-sm text-zinc-500">
        Recommended: set keys as <b>Netlify environment variables</b> (Site configuration → Environment variables), and they show up here as "env".
        Keys pasted here are stored <b>encrypted</b> in your database and override the environment.
      </p>
      <ErrorBox error={error || err} />
      <Card>
        <div className="space-y-4">
          {data && Object.entries(data.keys).map(([name, st]) => (
            <div key={name} className="grid gap-2 md:grid-cols-[220px_1fr_auto] md:items-center">
              <div>
                <div className="mono text-sm font-medium">{name}</div>
                <div className="mt-0.5">
                  {st.set ? <Badge color="green">set via {st.source} {st.preview}</Badge> : <Badge color="amber">not set</Badge>}
                </div>
              </div>
              <div>
                <input className="input mono" type="password" placeholder={st.set ? 'Replace key…' : 'Paste key…'}
                  value={draft[name] ?? ''} onChange={(e) => setDraft({ ...draft, [name]: e.target.value })} />
                <p className="mt-1 text-xs text-zinc-500">{DESCRIPTIONS[name]}</p>
              </div>
              {st.source === 'settings'
                ? <Button variant="ghost" onClick={() => save({ [name]: null })}>Clear</Button>
                : <span />}
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" loading={saving} disabled={!Object.values(draft).some(Boolean)}
            onClick={() => save(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)))}>Save keys</Button>
        </div>
      </Card>
    </div>
  );
}
