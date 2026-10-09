import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Eye, EyeOff, Play, RotateCw, Sparkles } from 'lucide-react';
import { api } from '../api';
import type { Run, Stats } from '../types';
import { Badge, Button, Card, ErrorBox, Progress, StatusBadge, Tabs } from '../components/ui';
import ReviewTab from './run/ReviewTab';
import ResultsTab from './run/ResultsTab';
import AuditTab from './run/AuditTab';

type Tab = 'review' | 'results' | 'audit' | 'config';

export default function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('review');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api.run(id), api.stats(id)]);
      setRun(r); setStats(s); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);
  const working = run && (run.busy || run.meta_status === 'running');
  useEffect(() => {
    if (!working) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [working, refresh]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusyAction(name); setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(String(e)); } finally { setBusyAction(null); }
  };

  if (!run || !stats) return err ? <ErrorBox error={err} /> : null;
  const p = stats.progress;
  const humanDone = p.human_needed > 0 && p.human_done >= p.human_needed;
  const canResume = !run.busy && (run.status === 'interrupted' || stats.slots.some((s) => s.errors > 0));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <a href="#/runs" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Runs</a>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{run.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <StatusBadge status={run.status} />
            {run.judge.enabled && <Badge color="indigo"><Sparkles className="h-3 w-3" /> judge: {run.judge_status.replace(/_/g, ' ')}</Badge>}
            <Badge>{run.slots.length} models</Badge>
            <Badge>{run.suite.cases.length} cases × {run.samples_per_case}</Badge>
            <Badge>{run.blind_mode === 'per_case' ? 'strict blinding' : 'consistent labels'}</Badge>
            {run.revealed ? <Badge color="indigo"><Eye className="h-3 w-3" /> revealed</Badge> : <Badge><EyeOff className="h-3 w-3" /> blind</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canResume && <Button loading={busyAction === 'resume'} onClick={() => act('resume', () => api.resumeRun(id))}><RotateCw className="h-4 w-4" /> Resume / retry errors</Button>}
          <Button loading={busyAction === 'judge' || run.judge_status === 'running'} disabled={run.busy}
            onClick={() => act('judge', () => api.judgeRun(id))}><Play className="h-4 w-4" /> {run.judge_status === 'idle' || run.judge_status === 'skipped' ? 'Run AI judge' : 'Re-run AI judge'}</Button>
          {run.revealed
            ? <Button onClick={() => act('hide', () => api.hide(id))}><EyeOff className="h-4 w-4" /> Re-blind</Button>
            : <Button variant="primary" onClick={() => {
                if (humanDone || confirm(`You've given ${p.human_done}/${p.human_needed} human ratings. Reveal identities anyway? Scoring after reveal is no longer blind.`)) act('reveal', () => api.reveal(id));
              }}><Eye className="h-4 w-4" /> Reveal models</Button>}
          <a href={api.exportUrl(id)} download={`${run.name}.json`}><Button variant="ghost" title="Export JSON"><Download className="h-4 w-4" /></Button></a>
        </div>
      </div>
      <ErrorBox error={err} />

      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <Progress label="Generations" value={p.generations_done} max={p.generations_total} />
          <Progress label="Your ratings" value={p.human_done} max={p.human_needed} />
          <Progress label="AI judge ratings" value={p.ai_done} max={p.ai_needed} />
        </div>
        {run.judge_errors.length > 0 && (
          <details className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            <summary className="cursor-pointer">{run.judge_errors.length} judge error(s)</summary>
            <ul className="mt-1 list-disc pl-5">{run.judge_errors.map((e, i) => <li key={i} className="mono">{e}</li>)}</ul>
          </details>
        )}
      </Card>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'review', label: `Blind review (${p.human_done}/${p.human_needed})` },
        { id: 'results', label: 'Results' },
        { id: 'audit', label: 'AI audit of the eval' },
        { id: 'config', label: 'Config' },
      ]} />

      {tab === 'review' && <ReviewTab run={run} onScored={refresh} />}
      {tab === 'results' && <ResultsTab run={run} stats={stats} onReveal={() => act('reveal', () => api.reveal(id))} />}
      {tab === 'audit' && <AuditTab run={run} onStart={() => act('meta', () => api.metaReview(id))} />}
      {tab === 'config' && (
        <Card>
          <pre className="mono overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify({
            slots: run.slots, judge: run.judge, samples_per_case: run.samples_per_case, concurrency: run.concurrency,
            blind_mode: run.blind_mode, suite: { name: run.suite.name, system_prompt: run.suite.system_prompt, criteria: run.suite.criteria, global_checks: run.suite.global_checks },
          }, null, 2)}</pre>
        </Card>
      )}
    </div>
  );
}
