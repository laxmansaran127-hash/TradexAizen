import type { Candle } from '@/types/trading';
import type { SwingPoint, MomentumResult, DivergenceSignal, VolatilityResult } from './types';
import { rsi, macd, atr, adx } from '@/lib/indicators';

// ── Divergence ──────────────────────────────────────────────────
// Regular divergence between price swings and an oscillator, using the two most
// recent CONFIRMED swings of the same type:
//   bullish: price makes a lower low, oscillator makes a higher low
//   bearish: price makes a higher high, oscillator makes a lower high
// Requirements keep it honest: swings 5–60 bars apart, the later swing within
// the last 40 bars, price difference ≥ 0.1 ATR, oscillator difference ≥ min.

function divergenceOn(
  candles: Candle[],
  swings: SwingPoint[],
  osc: (number | null)[],
  source: 'RSI' | 'MACD',
  minOscDiff: number,
  atrNow: number,
): DivergenceSignal[] {
  const out: DivergenceSignal[] = [];
  const n = candles.length;
  for (const type of ['low', 'high'] as const) {
    const pts = swings.filter(s => s.type === type);
    if (pts.length < 2) continue;
    const b = pts[pts.length - 1];
    const a = pts[pts.length - 2];
    const gap = b.index - a.index;
    if (gap < 5 || gap > 60 || b.index < n - 40) continue;
    const oa = osc[a.index], ob = osc[b.index];
    if (oa === null || ob === null) continue;
    if (type === 'low') {
      if (b.price < a.price - 0.1 * atrNow && ob > oa + minOscDiff) {
        out.push({ type: 'bullish', source, priceFrom: a.price, priceTo: b.price, oscFrom: oa, oscTo: ob, indexFrom: a.index, indexTo: b.index });
      }
    } else if (b.price > a.price + 0.1 * atrNow && ob < oa - minOscDiff) {
      out.push({ type: 'bearish', source, priceFrom: a.price, priceTo: b.price, oscFrom: oa, oscTo: ob, indexFrom: a.index, indexTo: b.index });
    }
  }
  return out;
}

export function analyzeMomentum(candles: Candle[], swings: SwingPoint[]): MomentumResult {
  const n = candles.length;
  const notes: string[] = [];
  if (n < 40) return { direction: 'neutral', state: 'flat', divergences: [], notes: ['Not enough candles for momentum analysis'] };

  const atrArr = atr(candles, 14);
  const atrNow = atrArr[n - 1] ?? 0;
  const rsiArr = rsi(candles, 14);
  const m = macd(candles, 12, 26, 9);
  const hist = m.histogram;
  const adxR = adx(candles, 14);

  const divergences = atrNow > 0
    ? [
        ...divergenceOn(candles, swings, rsiArr, 'RSI', 2, atrNow),
        // MACD histogram scale is price-dependent: require 10% of its recent magnitude
        ...divergenceOn(candles, swings, hist, 'MACD', 0.1 * recentAbsMean(hist, 30), atrNow),
      ]
    : [];

  const h0 = hist[n - 1], h1 = hist[n - 2], h2 = hist[n - 3], h3 = hist[n - 4];
  let direction: MomentumResult['direction'] = 'neutral';
  let state: MomentumResult['state'] = 'flat';

  if (h0 !== null && h1 !== null && h2 !== null && h3 !== null) {
    direction = h0 > 0 ? 'bullish' : h0 < 0 ? 'bearish' : 'neutral';
    const magnitudes = [Math.abs(h3), Math.abs(h2), Math.abs(h1), Math.abs(h0)];
    const rising = magnitudes[3] > magnitudes[2] && magnitudes[2] > magnitudes[1];
    const falling = magnitudes[3] < magnitudes[2] && magnitudes[2] < magnitudes[1];
    const sameSign = Math.sign(h0) === Math.sign(h1) && Math.sign(h1) === Math.sign(h2);
    if (sameSign && rising) { state = 'strengthening'; notes.push('MACD histogram expanding in the direction of the move for 3 bars'); }
    else if (sameSign && falling) { state = 'weakening'; notes.push('MACD histogram contracting for 3 bars'); }
  }

  const a0 = adxR.adx[n - 1], a3 = adxR.adx[n - 4];
  if (a0 !== null && a3 !== null) {
    if (a0 > a3 + 1 && state === 'flat') { state = 'strengthening'; notes.push(`ADX rising (${a3.toFixed(1)} → ${a0.toFixed(1)})`); }
    else if (a0 < a3 - 1 && state === 'flat') { state = 'weakening'; notes.push(`ADX falling (${a3.toFixed(1)} → ${a0.toFixed(1)})`); }
  }
  for (const d of divergences) {
    notes.push(`${d.type} ${d.source} divergence (price ${d.priceFrom.toPrecision(6)} → ${d.priceTo.toPrecision(6)})`);
  }
  return { direction, state, divergences, notes };
}

function recentAbsMean(arr: (number | null)[], count: number): number {
  let s = 0, k = 0;
  for (let i = arr.length - 1; i >= 0 && k < count; i--) {
    const v = arr[i];
    if (v !== null) { s += Math.abs(v); k++; }
  }
  return k ? s / k : 0;
}

// ── Volatility ──────────────────────────────────────────────────

export function analyzeVolatility(candles: Candle[]): VolatilityResult {
  const n = candles.length;
  const notes: string[] = [];
  const arr = atr(candles, 14);
  const now = arr[n - 1];
  if (n < 30 || now === null || now <= 0) {
    return { atr: null, atrPercent: null, regime: 'unknown', trend: 'unknown', lastBarAtrMultiple: null, minStopDistance: null, notes: ['Not enough candles for ATR'] };
  }
  const price = candles[n - 1].close;
  const atrPercent = (now / price) * 100;

  // Percentile of the current ATR within up to the last 100 values
  const window = arr.slice(Math.max(0, n - 100)).filter((v): v is number => v !== null);
  const below = window.filter(v => v <= now).length;
  const pct = window.length > 1 ? below / window.length : 0.5;
  const regime: VolatilityResult['regime'] =
    pct >= 0.97 ? 'extreme' : pct >= 0.8 ? 'high' : pct <= 0.2 ? 'low' : 'normal';

  // Expansion / contraction: ATR now vs 10 bars ago
  const prev = arr[n - 11];
  let trend: VolatilityResult['trend'] = 'unknown';
  if (prev !== null && prev !== undefined && prev > 0) {
    const ch = now / prev - 1;
    trend = ch > 0.15 ? 'expanding' : ch < -0.15 ? 'contracting' : 'stable';
  }

  const last = candles[n - 1];
  const lastBarAtrMultiple = (last.high - last.low) / now;
  if (lastBarAtrMultiple >= 2.5) notes.push(`Last bar range is ${lastBarAtrMultiple.toFixed(1)}× ATR — abnormal volatility`);
  if (regime === 'extreme') notes.push('ATR is in the top 3% of its recent range');
  if (regime === 'low') notes.push('ATR is in the bottom 20% of its recent range — compression, breakout risk');

  return { atr: now, atrPercent, regime, trend, lastBarAtrMultiple, minStopDistance: now * 1.5, notes };
}
