import type { Candle } from '@/types/trading';
import type { SwingPoint, LiquidityResult, LiquidityLevel, SRLevel, Zone } from './types';
import { atr as atrSeries } from '@/lib/indicators';

// ── Shared helper ───────────────────────────────────────────────

export function currentAtr(candles: Candle[], period = 14): number {
  const arr = atrSeries(candles, period);
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== null && v > 0) return v;
  }
  // Not enough candles for a real ATR: use the mean true range of what exists.
  let s = 0;
  const n = Math.min(candles.length, period);
  for (let i = candles.length - n; i < candles.length; i++) s += candles[i].high - candles[i].low;
  return n > 0 ? s / n : 0;
}

interface Cluster { price: number; swings: SwingPoint[] }

// ── Liquidity ───────────────────────────────────────────────────
// Buy-side liquidity rests above swing highs (stops of shorts / breakout buyers),
// sell-side below swing lows. A "sweep" requires a wick beyond an INTACT swing
// level followed by a CLOSE back inside it (same bar or the next one). A close
// beyond the level is a breakout, not a sweep. A reaction check (≥0.75 ATR away
// within 5 bars) separates a real stop-run from a wick that simply continued.

const REACTION_BARS = 5;
const RECENT_SWEEP_BARS = 12;

export function detectLiquidity(candles: Candle[], swings: SwingPoint[]): LiquidityResult {
  const n = candles.length;
  const a = currentAtr(candles);
  const levels: LiquidityLevel[] = [];
  const equalHighs: LiquidityResult['equalHighs'] = [];
  const equalLows: LiquidityResult['equalLows'] = [];
  if (n < 20 || a <= 0) return { levels, equalHighs, equalLows, recentSweep: null };

  const eqTol = a * 0.25;
  const lastClose = candles[n - 1].close;

  for (const side of ['high', 'low'] as const) {
    const pts = swings.filter(s => s.type === side).sort((x, y) => x.index - y.index);
    const clusters: Cluster[] = [];

    for (const sw of pts) {
      let target: Cluster | null = null;
      for (const cl of clusters) {
        if (Math.abs(cl.price - sw.price) > eqTol) continue;
        const lastIdx = cl.swings[cl.swings.length - 1].index;
        // the level must still be intact: no close beyond it between the two swings
        const lvl = side === 'high' ? Math.max(cl.price, sw.price) : Math.min(cl.price, sw.price);
        let intact = true;
        for (let t = lastIdx + 1; t < sw.index; t++) {
          if (side === 'high' ? candles[t].close > lvl + eqTol : candles[t].close < lvl - eqTol) { intact = false; break; }
        }
        if (intact) { target = cl; break; }
      }
      if (target) {
        target.swings.push(sw);
        target.price = target.swings.reduce((s, x) => s + x.price, 0) / target.swings.length;
      } else {
        clusters.push({ price: sw.price, swings: [sw] });
      }
    }

    for (const cl of clusters) {
      const level = side === 'high'
        ? Math.max(...cl.swings.map(s => s.price))
        : Math.min(...cl.swings.map(s => s.price));
      const last = cl.swings[cl.swings.length - 1];
      const isEqual = cl.swings.length >= 2;

      // scan forward for the first decisive event
      let swept = false, sweepIdx: number | undefined, broken = false;
      for (let t = last.index + 1; t < n; t++) {
        const c = candles[t];
        const wick = side === 'high' ? c.high > level : c.low < level;
        const closeBeyond = side === 'high' ? c.close > level : c.close < level;
        if (wick && !closeBeyond) { swept = true; sweepIdx = t; break; }
        if (wick && closeBeyond) {
          // 2-bar sweep: modest close beyond, then next bar closes back inside
          const modest = Math.abs(c.close - level) <= a * 0.5;
          const next = candles[t + 1];
          if (modest && next && (side === 'high' ? next.close <= level : next.close >= level)) {
            swept = true; sweepIdx = t + 1; break;
          }
          broken = true; break;
        }
      }
      if (broken) continue; // consumed by a real breakout

      let reaction: LiquidityLevel['reaction'];
      if (swept && sweepIdx !== undefined) {
        reaction = 'none';
        let stillInside = true;
        const end = Math.min(n - 1, sweepIdx + REACTION_BARS);
        for (let t = sweepIdx; t <= end; t++) {
          const c = candles[t];
          if (side === 'high' ? c.close > level : c.close < level) { stillInside = false; break; }
          const away = side === 'high' ? level - c.close : c.close - level;
          if (away >= a * 0.75) { reaction = 'confirmed'; break; }
        }
        if (reaction !== 'confirmed') {
          reaction = stillInside && n - 1 - sweepIdx < REACTION_BARS ? 'pending' : 'none';
        }
      }

      if (isEqual) {
        const entry = { price: level, indices: cl.swings.map(s => s.index), time: last.time };
        (side === 'high' ? equalHighs : equalLows).push(entry);
      }

      levels.push({
        type: side === 'high' ? 'buy-side' : 'sell-side',
        price: level, index: last.index, time: last.time,
        swept, sweepIndex: sweepIdx, sweepTime: sweepIdx !== undefined ? candles[sweepIdx].time : undefined,
        reaction, equal: isEqual,
      });
    }
  }

  // Keep only levels that matter now: recent sweeps + the nearest intact levels.
  const recent = levels.filter(l => l.swept && l.sweepIndex !== undefined && l.sweepIndex >= n - 40);
  const intactLevels = levels.filter(l => !l.swept);
  const above = intactLevels.filter(l => l.price > lastClose).sort((x, y) => x.price - y.price).slice(0, 4);
  const below = intactLevels.filter(l => l.price <= lastClose).sort((x, y) => y.price - x.price).slice(0, 4);
  const kept = [...recent, ...above, ...below];

  const candidates = recent.filter(l => l.sweepIndex! >= n - 1 - RECENT_SWEEP_BARS && l.reaction !== 'none');
  const recentSweep = candidates.length
    ? candidates.reduce((best, l) => (l.sweepIndex! > best.sweepIndex! ? l : best))
    : null;

  return {
    levels: kept,
    equalHighs: equalHighs.filter(e => e.price > lastClose - a * 6).slice(-4),
    equalLows: equalLows.filter(e => e.price < lastClose + a * 6).slice(-4),
    recentSweep,
  };
}

// ── Support / Resistance ────────────────────────────────────────
// Swing points are clustered into zones (width 0.5 ATR). Role is decided by
// where price is NOW. Strength counts swings, distinct touches and rejections;
// a breakout needs a CLOSE ≥0.25 ATR beyond the zone, a retest needs a later
// bar to return and close back on the breakout side.

export function detectSupportResistance(candles: Candle[], swings: SwingPoint[]): { support: SRLevel[]; resistance: SRLevel[] } {
  const n = candles.length;
  const a = currentAtr(candles);
  if (n < 20 || a <= 0 || swings.length === 0) return { support: [], resistance: [] };
  const price = candles[n - 1].close;
  const width = a * 0.5;
  const buffer = a * 0.25;

  const sorted = [...swings].sort((x, y) => x.price - y.price);
  const clusters: SwingPoint[][] = [];
  for (const sw of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur && sw.price - cur[cur.length - 1].price <= width) cur.push(sw);
    else clusters.push([sw]);
  }

  const resistance: SRLevel[] = [];
  const support: SRLevel[] = [];

  for (const cl of clusters) {
    const zoneLow = cl[0].price;
    const zoneHigh = cl[cl.length - 1].price;
    const mid = cl.reduce((s, x) => s + x.price, 0) / cl.length;
    const latest = cl.reduce((m, x) => (x.index > m.index ? x : m), cl[0]);
    const firstIdx = Math.min(...cl.map(x => x.index));
    const highsInCluster = cl.filter(x => x.type === 'high').length;
    const wasResistance = highsInCluster >= cl.length / 2;

    // touches / rejections over the full history
    let tested = 0, rejections = 0, inTouch = false;
    for (let t = firstIdx; t < n; t++) {
      const c = candles[t];
      const touching = c.low <= zoneHigh + a * 0.1 && c.high >= zoneLow - a * 0.1;
      if (touching && !inTouch) {
        tested++;
        const rejected = c.close < zoneLow || c.close > zoneHigh;
        if (rejected) rejections++;
      }
      inTouch = touching;
    }

    const isAbove = mid > price;      // level overhead → acts as resistance now
    const isBelow = mid < price;
    let breakout = false, retest = false, flipped = false;

    if (isBelow && wasResistance) {
      // was resistance, price now above it → check for a confirmed break + retest
      const bIdx = firstCloseIndex(candles, latest.index + 1, c => c.close > zoneHigh + buffer);
      if (bIdx !== -1) {
        breakout = true; flipped = true;
        retest = candles.slice(bIdx + 1).some(c => c.low <= zoneHigh + buffer && c.close >= zoneHigh);
      }
    } else if (isAbove && !wasResistance) {
      const bIdx = firstCloseIndex(candles, latest.index + 1, c => c.close < zoneLow - buffer);
      if (bIdx !== -1) {
        breakout = true; flipped = true;
        retest = candles.slice(bIdx + 1).some(c => c.high >= zoneLow - buffer && c.close <= zoneLow);
      }
    }

    // A level with price INSIDE it is contested — skip, it is neither above nor below.
    if (price >= zoneLow - buffer && price <= zoneHigh + buffer) continue;

    const strength = cl.length + tested + rejections + (flipped && retest ? 2 : 0);
    const lvl: SRLevel = {
      type: isAbove ? 'resistance' : 'support',
      price: mid, strength, index: latest.index, time: latest.time,
      tested, breakout, retest, rejections, zoneLow, zoneHigh, flipped,
    };
    (isAbove ? resistance : support).push(lvl);
  }

  // Rank by strength vs distance, keep the most relevant, then order nearest-first.
  const rank = (l: SRLevel) => l.strength / (1 + Math.abs(l.price - price) / a);
  const pick = (arr: SRLevel[]) =>
    arr.filter(l => Math.abs(l.price - price) <= a * 15)
      .sort((x, y) => rank(y) - rank(x))
      .slice(0, 5)
      .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price));

  return { support: pick(support), resistance: pick(resistance) };
}

function firstCloseIndex(candles: Candle[], from: number, pred: (c: Candle) => boolean): number {
  for (let i = Math.max(0, from); i < candles.length; i++) if (pred(candles[i])) return i;
  return -1;
}

// ── Supply / Demand ─────────────────────────────────────────────
// A zone is the BASE (last 1–3 small / opposite-coloured candles) that preceded
// an impulse: range ≥ 1.5 ATR, body-dominated, closing beyond the prior 5-bar
// extreme. The zone is then tracked forward: each separate return is a retest;
// a close beyond the distal edge invalidates it.

export function detectZones(candles: Candle[], swings: SwingPoint[]): Zone[] {
  void swings;
  const n = candles.length;
  const atrArr = atrSeries(candles, 14);
  const zones: Zone[] = [];
  if (n < 30) return zones;
  const lastAtr = currentAtr(candles);

  for (let i = 20; i < n - 1; i++) {
    const a = atrArr[i - 1];
    if (a === null || a <= 0) continue;
    const c = candles[i];
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    if (range < 1.5 * a || range === 0 || body / range < 0.6) continue;

    const bullish = c.close > c.open;
    let prior = bullish ? -Infinity : Infinity;
    for (let k = i - 5; k < i; k++) prior = bullish ? Math.max(prior, candles[k].high) : Math.min(prior, candles[k].low);
    if (bullish ? c.close <= prior : c.close >= prior) continue; // no structural break → not an origin impulse

    // base: up to 3 candles directly before the impulse that are small or opposite-coloured
    const base: Candle[] = [];
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
      const b = candles[k];
      const small = b.high - b.low <= 0.9 * (atrArr[k] ?? a);
      const opposite = bullish ? b.close < b.open : b.close > b.open;
      if (small || opposite) base.push(b); else break;
    }
    if (base.length === 0) continue;

    const bodyHi = Math.max(...base.map(b => Math.max(b.open, b.close)));
    const bodyLo = Math.min(...base.map(b => Math.min(b.open, b.close)));
    const hi = Math.max(...base.map(b => b.high));
    const lo = Math.min(...base.map(b => b.low));
    // demand: wick-low → top of bodies; supply: bottom of bodies → wick-high
    let top = bullish ? bodyHi : hi;
    let bottom = bullish ? lo : bodyLo;
    if (top <= bottom) { top = hi; bottom = lo; }
    if (top <= bottom) continue;

    // track forward
    let retests = 0, inside = false, invalidated = false, invalidatedIdx: number | undefined;
    for (let t = i + 1; t < n; t++) {
      const f = candles[t];
      if (bullish ? f.close < bottom : f.close > top) { invalidated = true; invalidatedIdx = t; break; }
      const entering = f.low <= top && f.high >= bottom;
      if (entering && !inside) retests++;
      inside = entering;
    }

    const impulseAtr = range / a;
    const reasons: string[] = [];
    let score = 0;
    if (impulseAtr >= 2.5) { score += 2; reasons.push(`${impulseAtr.toFixed(1)}× ATR impulse`); } else { score += 1; reasons.push(`${impulseAtr.toFixed(1)}× ATR impulse`); }
    if (base.length <= 2) { score += 1; reasons.push('tight base'); }
    if (retests === 0) { score += 1; reasons.push('untested'); } else if (retests >= 3) { score -= 1; reasons.push(`${retests} retests (weakening)`); }
    const strength: Zone['strength'] = score >= 4 ? 'strong' : score >= 2 ? 'moderate' : 'weak';

    zones.push({
      type: bullish ? 'demand' : 'supply',
      top, bottom, index: i - base.length, time: candles[Math.max(0, i - base.length)].time,
      fresh: !invalidated && retests === 0,
      mitigated: retests > 0,
      mitigatedIndex: undefined,
      retests, invalidated,
      invalidationPrice: bullish ? bottom : top,
      impulseAtr, strength,
      origin: `${base.length}-candle base before a ${bullish ? 'bullish' : 'bearish'} impulse that closed beyond the prior 5-bar ${bullish ? 'high' : 'low'} (${reasons.join(', ')})`,
    });
    void invalidatedIdx;
  }

  // Drop invalidated zones, merge near-duplicates of the same type, keep the closest to price.
  const live = zones.filter(z => !z.invalidated);
  const merged: Zone[] = [];
  for (const z of live.sort((x, y) => y.index - x.index)) {
    const dup = merged.find(m => m.type === z.type && z.bottom <= m.top && z.top >= m.bottom);
    if (!dup) merged.push(z);
  }
  const price = candles[n - 1].close;
  return merged
    .sort((x, y) => Math.abs((x.top + x.bottom) / 2 - price) - Math.abs((y.top + y.bottom) / 2 - price))
    .filter(z => Math.abs((z.top + z.bottom) / 2 - price) <= lastAtr * 20)
    .slice(0, 6);
}
