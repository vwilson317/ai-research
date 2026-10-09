/** Word-level diff (LCS) between the original text and a rewrite: deletions struck through, insertions highlighted. */
type Op = { t: 'same' | 'del' | 'add'; w: string };

function diff(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [{ t: 'del', w: a.join(' ') }, { t: 'add', w: b.join(' ') }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) { out.push({ t: 'same', w: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: 'del', w: a[i++] });
    else out.push({ t: 'add', w: b[j++] });
  }
  while (i < n) out.push({ t: 'del', w: a[i++] });
  while (j < m) out.push({ t: 'add', w: b[j++] });
  return out;
}

export function WordDiff({ before, after }: { before: string; after: string }) {
  const a = before.split(/\s+/).filter(Boolean), b = after.split(/\s+/).filter(Boolean);
  const ops = diff(a, b);
  const kept = ops.filter((o) => o.t === 'same').length;
  return (
    <div>
      <div className="mb-2 text-xs text-zinc-500">
        {a.length} → {b.length} words ({a.length ? Math.round((b.length / a.length) * 100) : 0}%) · {a.length ? Math.round((kept / a.length) * 100) : 0}% of original words kept
      </div>
      <div className="text-sm leading-relaxed">
        {ops.map((o, k) => o.t === 'same'
          ? <span key={k}>{o.w} </span>
          : o.t === 'del'
            ? <del key={k} className="bg-red-100 text-red-800 decoration-red-500 dark:bg-red-950 dark:text-red-300">{o.w}</del>
            : <ins key={k} className="bg-emerald-100 text-emerald-900 no-underline dark:bg-emerald-950 dark:text-emerald-300">{o.w}</ins>)
          .flatMap((el, k) => (ops[k].t === 'same' ? [el] : [el, <span key={`s${k}`}> </span>]))}
      </div>
    </div>
  );
}
