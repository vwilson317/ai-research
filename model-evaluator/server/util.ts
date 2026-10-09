import { randomBytes } from 'node:crypto';

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString('hex')}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const words = (s: string | null | undefined) => (s ?? '').split(/\s+/).filter(Boolean).length;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Run `fn` over `items` with at most `limit` in flight; `shouldStart` can stop new work (time budget). */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, shouldStart: () => boolean = () => true) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    // Always start at least one item so a continuation chain can never spin without progress.
    while (i < items.length && (i === 0 || shouldStart())) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
  return i; // number started
}

/** Deterministic PRNG (mulberry32) seeded from a string, for reproducible shuffles. */
export function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}
