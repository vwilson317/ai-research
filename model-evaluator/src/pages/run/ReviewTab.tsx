import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Sparkles, XCircle } from 'lucide-react';
import { api } from '../../api';
import type { Criterion, LibraryDoc, ReviewUnit, Run } from '../../types';
import { Badge, Button, Card, Empty, ErrorBox } from '../../components/ui';
import { Dialogue } from '../../components/Dialogue';
import { WordDiff } from '../../components/WordDiff';

function AttachedDoc({ runId, docId, title }: { runId: string; docId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<LibraryDoc | null>(null);
  useEffect(() => { if (open && !doc) api.runDoc(runId, docId).then(setDoc).catch(() => undefined); }, [open, doc, runId, docId]);
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium">
        <span>📎 {title}</span><span className="text-indigo-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && doc && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          {doc.segments ? <Dialogue segments={doc.segments} maxHeight="24rem" /> : <div className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm">{doc.text}</div>}
        </div>
      )}
    </div>
  );
}

function ScoreButtons({ c, value, onPick }: { c: Criterion; value: number | undefined; onPick: (v: number) => void }) {
  const opts = c.scale_max === 1 ? [{ v: 0, l: 'Fail' }, { v: 1, l: 'Pass' }] : Array.from({ length: c.scale_max }, (_, i) => ({ v: i + 1, l: String(i + 1) }));
  return (
    <div className="flex flex-wrap gap-1">
      {opts.map((o) => (
        <button key={o.v} onClick={() => onPick(o.v)}
          className={`min-w-[2rem] rounded border px-2 py-0.5 text-xs font-medium transition ${value === o.v
            ? 'border-indigo-600 bg-indigo-600 text-white'
            : 'border-zinc-300 hover:border-indigo-400 dark:border-zinc-700'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export default function ReviewTab({ run, onScored }: { run: Run; onScored: () => void }) {
  const [units, setUnits] = useState<ReviewUnit[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [alwaysShowAi, setAlwaysShowAi] = useState(false);
  const [showDiff, setShowDiff] = useState(run.suite.global_checks.some((c) => c.type.endsWith('length_ratio')));

  const humanCrit = run.suite.criteria.filter((c) => c.graded_by !== 'ai');
  const cases = useMemo(() => Object.fromEntries(run.suite.cases.map((c) => [c.id, c])), [run.suite.cases]);

  const load = useCallback(async () => {
    try { setUnits((await api.review(run.id, true)).units); } catch (e) { setErr(String(e)); }
  }, [run.id]);
  // reload when generation/judge progress or reveal state changes
  useEffect(() => { load(); }, [load, run.status, run.judge_status, run.revealed]);

  const unitDone = (u: ReviewUnit) => u.items.every((it) => it.status !== 'done' || humanCrit.every((c) => it.human[c.id] !== undefined));
  const nextUnscored = () => {
    if (!units) return;
    for (let k = 1; k <= units.length; k++) {
      const j = (idx + k) % units.length;
      if (!unitDone(units[j])) { setIdx(j); return; }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, (units?.length ?? 1) - 1));
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [units]);

  const pick = async (genId: string, critId: string, score: number) => {
    setUnits((us) => us && us.map((u) => ({ ...u, items: u.items.map((it) => it.generation_id === genId ? { ...it, human: { ...it.human, [critId]: { score } } } : it) })));
    try { await api.saveScores(run.id, [{ generation_id: genId, criterion_id: critId, score }]); onScored(); } catch (e) { setErr(String(e)); load(); }
  };

  if (!units) return err ? <ErrorBox error={err} /> : null;
  if (units.length === 0) return <Empty>No outputs yet.</Empty>;
  const unit = units[Math.min(idx, units.length - 1)];
  const tc = cases[unit.case_id];
  const done = unitDone(unit);
  const showAi = alwaysShowAi || done;
  const cols = unit.items.length <= 2 ? 'lg:grid-cols-2' : unit.items.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2 2xl:grid-cols-4';

  return (
    <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
      <aside className="order-2 lg:order-1">
        <div className="sticky top-4 max-h-[80vh] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
          {units.map((u, i) => (
            <button key={i} onClick={() => setIdx(i)}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${i === idx ? 'bg-indigo-50 font-medium dark:bg-indigo-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
              {unitDone(u) ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
              <span className="truncate">{u.case_id}{run.samples_per_case > 1 ? ` · s${u.sample + 1}` : ''}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="order-1 min-w-0 space-y-4 lg:order-2">
        <ErrorBox error={err} />
        <Card title={<>Case {idx + 1} / {units.length} <span className="mono font-normal text-zinc-500">· {unit.case_id}{run.samples_per_case > 1 ? ` · sample ${unit.sample + 1}` : ''}</span></>}
          actions={<>
            {tc?.tags.map((t) => <Badge key={t}>{t}</Badge>)}
            <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" disabled={idx >= units.length - 1} onClick={() => setIdx(idx + 1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button onClick={nextUnscored}>Next unscored</Button>
          </>}>
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm">{tc?.input}</div>
          {(tc?.context_doc_ids?.length ?? 0) > 0 && (
            <div className="mt-3 space-y-1.5">
              {tc!.context_doc_ids!.map((d) => <AttachedDoc key={d} runId={run.id} docId={d} title={run.doc_titles?.[d]?.title ?? d} />)}
            </div>
          )}
          {tc?.reference && (
            <div className="mt-3">
              <button className="text-xs text-indigo-600" onClick={() => setShowRef(!showRef)}>{showRef ? 'Hide' : 'Show'} reference answer</button>
              {showRef && <div className="mt-1 whitespace-pre-wrap rounded bg-zinc-50 p-2 text-sm dark:bg-zinc-800">{tc.reference}</div>}
            </div>
          )}
        </Card>

        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Order is shuffled per case. {done ? 'Case scored — AI judge scores shown.' : 'AI judge scores appear once you finish this case.'}</span>
          <span className="flex gap-3">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} /> Show edits vs. input</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={alwaysShowAi} onChange={(e) => setAlwaysShowAi(e.target.checked)} /> Always show AI scores</label>
          </span>
        </div>

        <div className={`grid gap-3 ${cols}`}>
          {unit.items.map((it) => (
            <Card key={it.generation_id} className="flex min-w-0 flex-col" title={
              <span className="flex items-center gap-2">
                {it.display_label}
                {it.model_label && <Badge color="indigo">{it.model_label}</Badge>}
              </span>}
              actions={<span className="text-xs text-zinc-500">{it.latency_ms != null && `${(it.latency_ms / 1000).toFixed(1)}s`}{it.output_tokens ? ` · ${it.output_tokens} tok` : ''}</span>}>
              {it.status === 'pending' && <p className="text-sm text-zinc-500">Generating…</p>}
              {it.error && <ErrorBox error={it.error} />}
              {it.output !== null && (showDiff && it.output
                ? <div className="max-h-96 overflow-y-auto break-words"><WordDiff before={tc?.input ?? ''} after={it.output} /></div>
                : <div className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm">{it.output || <i className="text-zinc-400">(empty response)</i>}</div>)}

              {it.checks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {it.checks.map((c, i) => (
                    <Badge key={i} color={c.passed ? 'green' : 'red'} title={c.detail}>
                      {c.passed ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{c.check}
                    </Badge>
                  ))}
                </div>
              )}

              {it.status === 'done' && (
                <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  {humanCrit.map((c) => {
                    const ai = it.ai?.[c.id];
                    return (
                      <div key={c.id}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium" title={`${c.description}\n\n${c.rubric}`}>{c.name}</span>
                          {showAi && ai && <Badge color="amber" title={ai.rationale ?? ''}><Sparkles className="h-3 w-3" /> AI {c.scale_max === 1 ? (ai.score ? 'Pass' : 'Fail') : `${ai.score}/${c.scale_max}`}</Badge>}
                        </div>
                        <ScoreButtons c={c} value={it.human[c.id]?.score} onPick={(v) => pick(it.generation_id, c.id, v)} />
                        {showAi && ai?.rationale && <p className="mt-1 text-xs italic text-zinc-500">{ai.rationale}</p>}
                      </div>
                    );
                  })}
                  {showAi && it.ai && run.suite.criteria.filter((c) => c.graded_by === 'ai').map((c) => it.ai![c.id] && (
                    <div key={c.id} className="text-xs">
                      <span className="font-medium">{c.name}</span> <Badge color="amber"><Sparkles className="h-3 w-3" /> AI {it.ai![c.id].score}/{c.scale_max === 1 ? 1 : c.scale_max}</Badge>
                      <p className="mt-0.5 italic text-zinc-500">{it.ai![c.id].rationale}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
        <p className="text-xs text-zinc-400">Tip: ← / → to move between cases. Hover a criterion name to see its rubric.</p>
      </div>
    </div>
  );
}
