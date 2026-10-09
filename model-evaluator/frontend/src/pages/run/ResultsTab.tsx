import { useState } from 'react';
import { EyeOff, Trophy } from 'lucide-react';
import type { Run, SlotStats, Stats } from '../../types';
import { Badge, Button, Card, fmt } from '../../components/ui';
import { GroupedBars, HeatCell, Legend } from '../../components/charts';

type SortKey = 'final_score' | 'human_score' | 'ai_score' | 'win_rate' | 'auto_pass_rate' | 'latency_avg_ms' | 'cost_usd';

const name = (s: SlotStats, revealed: boolean) => (revealed && s.label ? s.label : `Model ${s.slot}`);

export default function ResultsTab({ run, stats, onReveal }: { run: Run; stats: Stats; onReveal: () => void }) {
  const [sort, setSort] = useState<SortKey>('final_score');
  const rev = run.revealed;
  const lowerBetter = sort === 'latency_avg_ms' || sort === 'cost_usd';
  const rows = [...stats.slots].sort((a, b) => {
    const av = a[sort] ?? (lowerBetter ? Infinity : -Infinity), bv = b[sort] ?? (lowerBetter ? Infinity : -Infinity);
    return lowerBetter ? av - bv : bv - av;
  });
  const crit = run.suite.criteria;
  const ag = stats.agreement;
  const th = (k: SortKey, label: string, title?: string) => (
    <th title={title} onClick={() => setSort(k)} className={`cursor-pointer whitespace-nowrap px-2 py-2 text-right font-medium hover:text-indigo-600 ${sort === k ? 'text-indigo-600' : ''}`}>{label}{sort === k ? ' ▾' : ''}</th>
  );
  const sortedCases = [...stats.cases].filter((c) => c.spread !== null).sort((a, b) => (a.spread ?? 0) - (b.spread ?? 0));

  return (
    <div className="space-y-4">
      {!rev && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <span className="flex items-center gap-2"><EyeOff className="h-4 w-4" /> Model identities are hidden. Review the scores, then reveal who's who.</span>
          <Button variant="primary" onClick={onReveal}>Reveal models</Button>
        </div>
      )}

      <Card title={<span className="flex items-center gap-1.5"><Trophy className="h-4 w-4 text-amber-500" /> Leaderboard</span>}
        actions={<span className="text-xs text-zinc-500">Scores are weighted criterion averages normalised to 0–100. “Final” uses your score where available, AI judge otherwise. Click a header to sort.</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-2 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">Model</th>
                {th('final_score', 'Final')}
                {th('human_score', 'Human')}
                {th('ai_score', 'AI judge')}
                {th('win_rate', 'Win rate', 'Head-to-head wins per case (ties = ½)')}
                {th('auto_pass_rate', 'Checks', 'Automatic check pass rate')}
                {th('latency_avg_ms', 'Latency', 'Average (p95)')}
                <th className="px-2 py-2 text-right font-medium" title="Average output tokens / words">Length</th>
                {th('cost_usd', 'Cost')}
                <th className="px-2 py-2 text-right font-medium" title="Mean std-dev of score across samples of the same case (lower = more consistent)">σ</th>
                <th className="px-2 py-2 text-right font-medium">Errors</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.slot} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-2 py-2 text-zinc-400">{i + 1}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium">{name(s, rev)}</div>
                    {rev && <div className="mono text-xs text-zinc-500">Model {s.slot} · {s.provider}/{s.model}</div>}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmt(s.final_score)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(s.human_score)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(s.ai_score)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(s.win_rate, 0, '%')}<div className="text-[10px] text-zinc-400">{s.wins}W {s.ties}T {s.losses}L</div></td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(s.auto_pass_rate, 0, '%')}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.latency_avg_ms != null ? `${(s.latency_avg_ms / 1000).toFixed(2)}s` : '—'}<div className="text-[10px] text-zinc-400">p95 {s.latency_p95_ms != null ? `${(s.latency_p95_ms / 1000).toFixed(2)}s` : '—'}</div></td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(s.avg_output_tokens, 0)}<div className="text-[10px] text-zinc-400">{fmt(s.avg_output_words, 0)} words</div></td>
                  <td className="px-2 py-2 text-right tabular-nums">${s.cost_usd.toFixed(4)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(s.consistency_std)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.errors ? <Badge color="red">{s.errors}</Badge> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Overall: human vs AI judge" actions={<Legend />}>
          <GroupedBars rows={stats.slots.map((s) => ({ key: s.slot, label: name(s, rev), human: s.human_score, ai: s.ai_score }))} />
        </Card>
        <Card title="Human ↔ AI judge agreement">
          {ag.overall ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Correlation (r)" value={fmt(ag.overall.pearson, 2)} hint="1 = perfect agreement" />
                <Stat label="Mean abs. diff" value={fmt(ag.overall.mae, 1)} hint="points on 0–100" />
                <Stat label="AI bias" value={ag.overall.ai_bias != null ? `${ag.overall.ai_bias > 0 ? '+' : ''}${ag.overall.ai_bias.toFixed(1)}` : '—'} hint="+ = judge more lenient" />
              </div>
              <div className="text-xs text-zinc-500">
                Ranking — you: <b>{ag.human_ranking.join(' > ') || '—'}</b> · judge: <b>{ag.ai_ranking.join(' > ') || '—'}</b>
                {ag.human_ranking.length > 1 && ag.human_ranking.join() === ag.ai_ranking.join() && <Badge color="green">same order</Badge>}
              </div>
              <table className="w-full text-xs">
                <thead className="text-zinc-500"><tr><th className="py-1 text-left font-medium">Criterion</th><th className="text-right font-medium">n</th><th className="text-right font-medium">r</th><th className="text-right font-medium">MAE</th><th className="text-right font-medium">±1 pt</th><th className="text-right font-medium">bias</th></tr></thead>
                <tbody>
                  {crit.map((c) => {
                    const a = ag.by_criterion[c.id];
                    return a ? (
                      <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1">{c.name}</td><td className="text-right">{a.n}</td><td className="text-right">{fmt(a.pearson, 2)}</td>
                        <td className="text-right">{fmt(a.mae)}</td><td className="text-right">{fmt(a.within_one_point, 0, '%')}</td><td className="text-right">{fmt(a.ai_bias)}</td>
                      </tr>
                    ) : null;
                  })}
                </tbody>
              </table>
              <div className="text-xs text-zinc-500">
                Length bias — score vs. word count correlation: judge r = {fmt(stats.bias.ai_score_vs_length_r, 2)}, you r = {fmt(stats.bias.human_score_vs_length_r, 2)}.
                {(stats.bias.ai_score_vs_length_r ?? 0) > 0.5 && <span className="text-amber-600"> The judge may be rewarding length.</span>}
              </div>
            </div>
          ) : <p className="text-sm text-zinc-500">Needs criteria graded by both you and the AI judge. Score some outputs in the Blind review tab.</p>}
        </Card>
      </div>

      <Card title="By criterion" actions={<Legend />}>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {crit.map((c) => (
            <div key={c.id}>
              <div className="mb-2 text-sm font-medium">{c.name} <span className="text-xs font-normal text-zinc-500">×{c.weight} · {c.scale_max === 1 ? 'pass/fail' : `1–${c.scale_max}`}</span></div>
              <GroupedBars compact rows={stats.slots.map((s) => ({
                key: s.slot, label: name(s, rev),
                human: c.graded_by === 'ai' ? null : s.criteria[c.id]?.human ?? null,
                ai: c.graded_by === 'human' ? null : s.criteria[c.id]?.ai ?? null,
              }))} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Per-case scores & discrimination" actions={<span className="text-xs text-zinc-500">Sorted by spread — cases at the top barely separate the models and may be too easy, too hard or ambiguous</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Case</th>
                {stats.slots.map((s) => <th key={s.slot} className="px-2 py-1 font-medium">{name(s, rev)}</th>)}
                <th className="px-2 py-1 text-right font-medium">Spread</th>
              </tr>
            </thead>
            <tbody>
              {sortedCases.map((c) => (
                <tr key={c.case_id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="max-w-md px-2 py-1"><div className="mono text-xs text-zinc-500">{c.case_id} {c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div><div className="truncate text-xs" title={c.input}>{c.input}</div></td>
                  {stats.slots.map((s) => <HeatCell key={s.slot} v={c.per_slot[s.slot]} />)}
                  <td className="px-2 py-1 text-right tabular-nums">{c.spread !== null && c.spread < 5 ? <Badge color="amber">{fmt(c.spread, 0)}</Badge> : fmt(c.spread, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedCases.length === 0 && <p className="text-sm text-zinc-500">No scores yet.</p>}
        </div>
      </Card>

      {stats.disagreements.length > 0 && (
        <Card title="Biggest human vs AI disagreements">
          <table className="w-full text-xs">
            <thead className="text-zinc-500"><tr><th className="py-1 text-left font-medium">Case</th><th className="text-left font-medium">Model</th><th className="text-left font-medium">Criterion</th><th className="text-right font-medium">You</th><th className="text-right font-medium">AI</th></tr></thead>
            <tbody>
              {stats.disagreements.filter((d) => d.diff > 0).slice(0, 10).map((d, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="mono py-1">{d.case_id}</td>
                  <td>{d.slot ? name(stats.slots.find((s) => s.slot === d.slot)!, rev) : 'hidden'}</td>
                  <td>{crit.find((c) => c.id === d.criterion_id)?.name}</td>
                  <td className="text-right">{d.human}</td><td className="text-right">{d.ai}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-zinc-600 dark:text-zinc-400">{label}</div>
      <div className="text-[10px] text-zinc-400">{hint}</div>
    </div>
  );
}
