import { useState } from 'react';

export interface BarRow { key: string; label: string; human: number | null; ai: number | null }

const SERIES = [
  { id: 'human' as const, name: 'Human', color: 'var(--series-human)' },
  { id: 'ai' as const, name: 'AI judge', color: 'var(--series-ai)' },
];

export function Legend({ only }: { only?: ('human' | 'ai')[] }) {
  return (
    <div className="flex gap-4 text-xs text-zinc-600 dark:text-zinc-400">
      {SERIES.filter((s) => !only || only.includes(s.id)).map((s) => (
        <span key={s.id} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}
        </span>
      ))}
    </div>
  );
}

/** Horizontal grouped bars on a shared 0–100 scale: human vs AI-judge score per row. */
export function GroupedBars({ rows, compact }: { rows: BarRow[]; compact?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const series = SERIES.filter((s) => rows.some((r) => r[s.id] !== null));
  const barH = compact ? 8 : 12;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(4rem,9rem)_1fr] items-center gap-2">
          <div className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300" title={r.label}>{r.label}</div>
          <div className="relative space-y-[2px] border-l border-zinc-300 dark:border-zinc-600">
            {[25, 50, 75].map((t) => <div key={t} className="pointer-events-none absolute inset-y-0 border-l border-dashed" style={{ left: `${t}%`, borderColor: 'var(--grid)' }} />)}
            {series.map((s) => {
              const v = r[s.id];
              const id = `${r.key}-${s.id}`;
              return (
                <div key={s.id} className="relative flex items-center" style={{ height: barH + 4 }}
                  onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}>
                  {v !== null && (
                    <div className="h-full rounded-r transition-[width]" style={{ width: `${Math.max(v, 0.5)}%`, height: barH, background: s.color, opacity: hover && hover !== id ? 0.55 : 1 }} />
                  )}
                  <span className="ml-1.5 text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">{v === null ? '—' : v.toFixed(1)}</span>
                  {hover === id && (
                    <div className="absolute left-1/2 top-full z-20 mt-1 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs text-white shadow dark:bg-zinc-100 dark:text-zinc-900">
                      {r.label} · {s.name}: {v === null ? 'no scores' : `${v.toFixed(1)} / 100`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-[minmax(4rem,9rem)_1fr] gap-2 text-[10px] text-zinc-400">
        <span />
        <div className="flex justify-between"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      </div>
    </div>
  );
}

/** Sequential single-hue cell for case × model heat tables. */
export function HeatCell({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <td className="px-2 py-1 text-center text-xs text-zinc-400">—</td>;
  const a = 0.08 + (v / 100) * 0.72;
  return (
    <td className="px-2 py-1 text-center text-xs tabular-nums" style={{ background: `rgba(42,120,214,${a})`, color: v > 60 ? 'white' : undefined }}>
      {v.toFixed(0)}
    </td>
  );
}
