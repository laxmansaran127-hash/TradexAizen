import type { Candle } from '@/types/trading';
import type {
  LiquidityResult, MarketStructureResult, SRLevel, TargetBasis, TradeSetup, Zone,
} from './types';

// ── Trade plan ──────────────────────────────────────────────────
// Everything is derived from the analysed candles:
//   entry         : last CLOSED price (reference) ± a small ATR band
//   invalidation  : the nearest structural level whose break kills the idea
//                   (swing low/high, demand/supply zone edge, sweep extreme)
//   stop          : invalidation ± 0.5 ATR buffer, constrained to 1–4 ATR
//   targets       : real levels in the path (S/R zones, liquidity pools,
//                   opposing zones). If fewer than 3 exist the remainder are
//                   R-multiple PROJECTIONS and are labelled as such.
// A plan is refused (null + reason) when there is no structural stop in range,
// less than 1R of room before the nearest obstacle, or R:R to TP2 < 1.5.

export interface PlanInput {
  direction: 'long' | 'short';
  candles: Candle[];          // closed candles only
  atr: number;
  structure: MarketStructureResult;
  support: SRLevel[];
  resistance: SRLevel[];
  liquidity: LiquidityResult;
  zones: Zone[];
  decimals: number;
}

export interface PlanOutput { setup: TradeSetup | null; reason: string }

const fmt = (v: number, d: number) => v.toFixed(d);

export function buildTradePlan(inp: PlanInput): PlanOutput {
  const { direction, candles, atr, structure, liquidity, zones, decimals } = inp;
  const n = candles.length;
  if (n < 30 || !(atr > 0)) return { setup: null, reason: 'Not enough data for a risk plan (ATR unavailable)' };

  const long = direction === 'long';
  const sgn = long ? 1 : -1;
  const entry = candles[n - 1].close;
  const buffer = atr * 0.5;

  // ── invalidation candidates (levels on the protective side of entry) ──
  const cands: { price: number; label: string }[] = [];
  const swings = structure.swings.filter(s => s.type === (long ? 'low' : 'high'));
  for (const s of swings) {
    if (long ? s.price < entry : s.price > entry) cands.push({ price: s.price, label: `${long ? 'swing low' : 'swing high'} ${fmt(s.price, decimals)}` });
  }
  for (const z of zones) {
    if (z.invalidated) continue;
    if (long && z.type === 'demand' && z.bottom < entry) cands.push({ price: z.bottom, label: `demand zone low ${fmt(z.bottom, decimals)}` });
    if (!long && z.type === 'supply' && z.top > entry) cands.push({ price: z.top, label: `supply zone high ${fmt(z.top, decimals)}` });
  }
  const sw = liquidity.recentSweep;
  if (sw && sw.sweepIndex !== undefined) {
    const sc = candles[sw.sweepIndex];
    if (long && sw.type === 'sell-side' && sc.low < entry) cands.push({ price: sc.low, label: `sweep low ${fmt(sc.low, decimals)}` });
    if (!long && sw.type === 'buy-side' && sc.high > entry) cands.push({ price: sc.high, label: `sweep high ${fmt(sc.high, decimals)}` });
  }

  // nearest-first on the protective side; accept the first whose buffered distance is 1–4 ATR
  cands.sort((a, b) => (long ? b.price - a.price : a.price - b.price));
  let chosen: { price: number; label: string } | null = null;
  let stop = 0;
  for (const c of cands) {
    const s = c.price - sgn * buffer;
    const dist = (entry - s) * sgn;
    if (dist >= atr && dist <= 4 * atr) { chosen = c; stop = s; break; }
  }
  if (!chosen) {
    return { setup: null, reason: `No structural stop between 1 and 4 ATR from entry (${cands.length} candidate level(s) checked)` };
  }
  const risk = (entry - stop) * sgn;

  // ── target candidates (real levels in the path) ──
  const raw: { price: number; label: string }[] = [];
  const targets = long ? inp.resistance : inp.support;
  for (const t of targets) {
    const edge = long ? (t.zoneLow ?? t.price) : (t.zoneHigh ?? t.price);
    if ((edge - entry) * sgn > 0) raw.push({ price: edge, label: `${long ? 'resistance' : 'support'} ${fmt(t.price, decimals)}` });
  }
  for (const l of liquidity.levels) {
    if (l.swept) continue;
    if (long && l.type === 'buy-side' && l.price > entry) raw.push({ price: l.price, label: `buy-side liquidity ${fmt(l.price, decimals)}${l.equal ? ' (equal highs)' : ''}` });
    if (!long && l.type === 'sell-side' && l.price < entry) raw.push({ price: l.price, label: `sell-side liquidity ${fmt(l.price, decimals)}${l.equal ? ' (equal lows)' : ''}` });
  }
  for (const z of zones) {
    if (z.invalidated) continue;
    if (long && z.type === 'supply' && z.bottom > entry) raw.push({ price: z.bottom, label: `supply zone ${fmt(z.bottom, decimals)}` });
    if (!long && z.type === 'demand' && z.top < entry) raw.push({ price: z.top, label: `demand zone ${fmt(z.top, decimals)}` });
  }
  raw.sort((a, b) => (long ? a.price - b.price : b.price - a.price));
  const levels: { price: number; label: string }[] = [];
  for (const r of raw) {
    const last = levels[levels.length - 1];
    if (!last || Math.abs(r.price - last.price) >= atr * 0.3) levels.push(r);
  }

  if (levels.length > 0 && (levels[0].price - entry) * sgn < risk) {
    const room = (levels[0].price - entry) * sgn / risk;
    return { setup: null, reason: `Only ${room.toFixed(2)}R of room before ${levels[0].label} — insufficient reward for the risk` };
  }

  const tp: number[] = [];
  const basis: TargetBasis[] = [];
  for (let k = 0; k < 3; k++) {
    const prev = k === 0 ? entry : tp[k - 1];
    const structural = levels.find(l => (l.price - prev) * sgn >= (k === 0 ? 0 : atr * 0.5));
    if (structural && !tp.includes(structural.price)) {
      tp.push(structural.price);
      basis.push({ kind: 'structure', label: structural.label });
      levels.splice(levels.indexOf(structural), 1);
    } else {
      const mult = k + 1;
      const proj = entry + sgn * Math.max(risk * mult, ((prev - entry) * sgn) + risk);
      tp.push(proj);
      basis.push({ kind: 'projection', label: `${mult}R projection — no structural level in range` });
    }
  }

  const rr = tp.map(t => ((t - entry) * sgn) / risk);
  if (rr[1] < 1.5) return { setup: null, reason: `R:R to TP2 is ${rr[1].toFixed(2)} (< 1.5 minimum)` };

  const setup: TradeSetup = {
    direction,
    entryZone: long ? { low: entry - atr * 0.25, high: entry + atr * 0.1 } : { low: entry - atr * 0.1, high: entry + atr * 0.25 },
    entry,
    stopLoss: stop,
    tp1: tp[0], tp2: tp[1], tp3: tp[2],
    invalidation: chosen.price,
    riskReward: rr[1],
    riskDistance: risk,
    stopAtrMultiple: risk / atr,
    rrTp1: rr[0], rrTp2: rr[1], rrTp3: rr[2],
    tpBasis: [basis[0], basis[1], basis[2]],
    stopBasis: `${long ? 'below' : 'above'} ${chosen.label} with a 0.5 ATR buffer`,
    riskGuidance:
      `Stop distance is ${fmt(risk, decimals)} (${(risk / atr).toFixed(1)}× ATR). Choose the fraction of equity you are willing to lose on a stop-out ` +
      `(many traders cap this at 1% or less) and size the position = (equity × risk%) ÷ ${fmt(risk, decimals)} per unit. Spread, slippage and gaps can make losses larger than planned.`,
  };
  return { setup, reason: 'Valid structural plan' };
}
