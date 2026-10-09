import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { api } from '../../api';
import type { Run } from '../../types';
import { Badge, Button, Card, ErrorBox } from '../../components/ui';

const SEV: Record<string, 'red' | 'amber' | 'gray'> = { high: 'red', medium: 'amber', low: 'gray' };

export default function AuditTab({ run, onStart }: { run: Run; onStart: () => void }) {
  const m = run.meta_review;
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const running = run.meta_status === 'running';

  const addCase = async (i: number, input: string, reference?: string) => {
    try {
      const suite = await api.suite(run.suite.id!);
      const ids = suite.cases.map((c) => c.id);
      let n = suite.cases.length + 1, cid = `ai${n}`;
      while (ids.includes(cid)) cid = `ai${++n}`;
      await api.updateSuite(suite.id!, { ...suite, cases: [...suite.cases, { id: cid, input, reference: reference || null, tags: ['ai-suggested'], checks: [] }] });
      setAdded(new Set(added).add(i));
    } catch (e) { setErr(String(e)); }
  };

  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-indigo-500" /> Evaluate the evaluation</span>}
        actions={<Button variant="primary" loading={running} disabled={run.busy} onClick={onStart}>{m ? 'Re-run audit' : 'Run audit'}</Button>}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The judge model (<span className="mono">{run.judge.model}</span>) reviews your suite design, the anonymised results and where you and the AI judge disagreed, and tells you
          whether the eval is measuring what you want: weak or non-discriminating cases, vague rubrics, overlapping criteria, judge bias, and what to add. Works best after you've done some human scoring.
        </p>
        {run.meta_status === 'error' && <div className="mt-2"><ErrorBox error={run.meta_error} /></div>}
        <ErrorBox error={err} />
      </Card>

      {m && (
        <>
          <Card title="Verdict" actions={m.overall_quality != null && <Badge color={m.overall_quality >= 7 ? 'green' : m.overall_quality >= 4 ? 'amber' : 'red'}>Eval quality {m.overall_quality}/10</Badge>}>
            <p className="text-sm">{m.summary}</p>
            {m.judge_reliability && <p className="mt-3 text-sm"><b>Judge reliability:</b> {m.judge_reliability}</p>}
            {m.strengths && m.strengths.length > 0 && (
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-emerald-700 dark:text-emerald-400">{m.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            )}
          </Card>

          {m.issues && m.issues.length > 0 && (
            <Card title="Issues">
              <div className="space-y-2">
                {m.issues.map((it, i) => (
                  <div key={i} className="text-sm">
                    <Badge color={SEV[it.severity] ?? 'gray'}>{it.severity}</Badge> <b>{it.title}</b>
                    <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{it.detail}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {m.criteria_feedback && m.criteria_feedback.length > 0 && (
              <Card title="Criteria & rubric feedback">
                <div className="space-y-3 text-sm">
                  {m.criteria_feedback.map((f, i) => (
                    <div key={i}>
                      <b>{run.suite.criteria.find((c) => c.id === f.criterion_id)?.name ?? f.criterion_id}</b>
                      <p className="text-zinc-600 dark:text-zinc-400">{f.feedback}</p>
                      {f.suggested_rubric && <pre className="mono mt-1 whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800">{f.suggested_rubric}</pre>}
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {m.non_discriminative_cases && m.non_discriminative_cases.length > 0 && (
              <Card title="Cases that don't separate models">
                <ul className="space-y-1 text-sm">{m.non_discriminative_cases.map((c, i) => <li key={i}><span className="mono">{c.case_id}</span> — {c.why}</li>)}</ul>
              </Card>
            )}
          </div>

          {m.suggested_cases && m.suggested_cases.length > 0 && (
            <Card title="Suggested new test cases">
              <div className="space-y-3">
                {m.suggested_cases.map((c, i) => (
                  <div key={i} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                    <div className="whitespace-pre-wrap">{c.input}</div>
                    {c.reference && <div className="mt-1 text-xs text-zinc-500"><b>Reference:</b> {c.reference}</div>}
                    {c.why && <div className="mt-1 text-xs italic text-zinc-500">{c.why}</div>}
                    <Button className="mt-2" variant="ghost" disabled={added.has(i)} onClick={() => addCase(i, c.input, c.reference)}>
                      <Plus className="h-4 w-4" /> {added.has(i) ? 'Added to suite' : 'Add to suite'}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {m.recommendations && m.recommendations.length > 0 && (
            <Card title="Recommendations">
              <ol className="list-decimal space-y-1 pl-5 text-sm">{m.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ol>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
