import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, Empty, ErrorBox, StatusBadge, useAsync } from '../components/ui';

export default function RunsPage() {
  const { data: runs, error, reload } = useAsync(api.runs, []);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Runs</h1>
        <a href="#/new"><Button variant="primary">New run</Button></a>
      </div>
      <ErrorBox error={error} />
      {runs?.length === 0 && <Empty>No runs yet. <a className="text-indigo-600" href="#/new">Start your first evaluation →</a></Empty>}
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {runs?.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800">
            <a href={`#/runs/${r.id}`} className="min-w-0 flex-1 basis-full sm:basis-0">
              <div className="truncate font-medium hover:text-indigo-600">{r.name}</div>
              <div className="text-xs text-zinc-500">{new Date(r.created_at).toLocaleString()} · {r.suite.name} · {r.suite.cases} cases × {r.samples_per_case} sample{r.samples_per_case > 1 ? 's' : ''}</div>
            </a>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge>{r.slots.length} models</Badge>
              <StatusBadge status={r.status} />
              {r.revealed ? <Badge color="indigo"><Eye className="h-3 w-3" /> revealed</Badge> : <Badge><EyeOff className="h-3 w-3" /> blind</Badge>}
              <Button variant="ghost" title="Delete run" disabled={r.busy} onClick={async () => { if (confirm('Delete this run and all its scores?')) { await api.deleteRun(r.id); reload(); } }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
