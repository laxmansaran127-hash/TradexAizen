// Minimal test harness (no external deps).
let passed = 0, failed = 0;
const failures: string[] = [];
let chain: Promise<void> = Promise.resolve();

export function test(name: string, fn: () => void | Promise<void>) {
  // Tests run strictly one after another (they may share global fakes).
  chain = chain.then(async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; failures.push(name); console.log(`  ✗ ${name}\n      ${(e as Error).message}`); }
  });
}
export function section(name: string) { chain = chain.then(() => { console.log(`\n${name}`); }); }
export async function done() {
  await chain;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
}
export function assert(cond: unknown, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
export function approx(a: number, b: number, tol = 1e-6, msg = '') {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg} expected ${b}, got ${a} (tol ${tol})`);
}

// ── Deterministic fixture generators (TEST DATA ONLY — never shipped in the app) ──
export function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
import type { Candle } from '../src/types/trading';
export function candlesFromCloses(closes: number[], start = 1_700_000_000, tf = 3600, spread = 0.5): Candle[] {
  const t0 = Math.floor(start / tf) * tf;
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return { time: t0 + i * tf, open: o, high: Math.max(o, c) + spread, low: Math.min(o, c) - spread, close: c, volume: 100 + (i % 7) * 10 };
  });
}
export function randomWalk(n: number, seed: number, start = 100, vol = 1, tf = 3600): Candle[] {
  const r = prng(seed); const out: Candle[] = []; let p = start;
  const t0 = Math.floor(1_700_000_000 / tf) * tf;
  for (let i = 0; i < n; i++) {
    const o = p; const c = Math.max(1, o + (r() - 0.5) * 2 * vol);
    out.push({ time: t0 + i * tf, open: o, high: Math.max(o, c) + r() * vol * 0.5, low: Math.min(o, c) - r() * vol * 0.5, close: c, volume: 50 + r() * 100 });
    p = c;
  }
  return out;
}
