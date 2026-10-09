import { useRef, useState } from 'react';
import { Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import { go } from '../router';
import type { Suite } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, useAsync } from '../components/ui';

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function SuitesPage() {
  const { data: suites, error, reload } = useAsync(api.suites, []);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async (s: Suite) => {
    try { const created = await api.createSuite(s); go(`/suites/${created.id}`); } catch (e) { setErr(String(e)); }
  };

  const importFile = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text());
      const s: Suite = { name: 'Imported suite', description: '', system_prompt: '', cases: [], criteria: [], global_checks: [], ...parsed };
      delete s.id;
      await create(s);
    } catch (e) { setErr(`Import failed: ${e}`); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Eval suites</h1>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Import JSON</Button>
          <Button variant="primary" onClick={() => create({ name: 'Untitled suite', description: '', system_prompt: '', cases: [], criteria: [], global_checks: [] })}>
            <Plus className="h-4 w-4" /> New suite
          </Button>
        </div>
      </div>
      <p className="text-sm text-zinc-500">A suite is your evaluation definition: test cases (prompts + optional reference answers + automatic checks) and the scoring criteria that humans and the AI judge grade against.</p>
      <ErrorBox error={error || err} />
      {suites?.length === 0 && <Empty>No suites yet — create one or import JSON.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {suites?.map((s) => (
          <Card key={s.id}>
            <a href={`#/suites/${s.id}`} className="block font-medium hover:text-indigo-600">{s.name}</a>
            <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{s.description || 'No description'}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge>{s.cases.length} cases</Badge>
              <Badge>{s.criteria.length} criteria</Badge>
              {s.global_checks.length > 0 && <Badge>{s.global_checks.length} global checks</Badge>}
            </div>
            <div className="mt-3 flex gap-1">
              <Button variant="ghost" onClick={() => go(`/suites/${s.id}`)}>Edit</Button>
              <Button variant="ghost" title="Duplicate" onClick={() => create({ ...s, id: undefined, name: `${s.name} (copy)` })}><Copy className="h-4 w-4" /></Button>
              <Button variant="ghost" title="Export JSON" onClick={() => download(`${s.name}.json`, { ...s, id: undefined })}><Download className="h-4 w-4" /></Button>
              <Button variant="ghost" title="Delete" onClick={async () => { if (confirm(`Delete ${s.name}?`)) { await api.deleteSuite(s.id!); reload(); } }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
