import type { Candle } from '@/types/trading';
import type { SwingPoint, MarketStructureResult, StructureLabel, StructureEvent, StructureState } from './types';
import { atr as atrSeries } from '@/lib/indicators';

// ── Swing Point Detection ───────────────────────────────────────
// A swing high/low is the extreme of a window of `lookback` bars on each side.
// A swing at index i is only KNOWN once bar i+lookback has closed — the
// structure walk below respects that, so there is no look-ahead.

export function findSwings(candles: Candle[], lookback: number = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      // strict on the left, ties allowed on the right → the FIRST of equal extremes is the swing
      if (candles[i].high <= candles[i - j].high || candles[i].high < candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low > candles[i + j].low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) swings.push({ index: i, price: candles[i].high, time: candles[i].time, type: 'high', confirmed: true });
    if (isLow) swings.push({ index: i, price: candles[i].low, time: candles[i].time, type: 'low', confirmed: true });
  }

  return swings;
}

// ── Market Structure ────────────────────────────────────────────
//
//  • HH/HL/LH/LL labels compare each swing with the previous swing of the same type.
//  • BOS   : a candle CLOSES beyond the latest confirmed swing in the direction
//            of the prevailing trend (continuation).
//  • CHOCH : a candle CLOSES beyond the latest confirmed swing AGAINST the
//            prevailing trend (first sign of a character change).
//  • MSS   : a CHOCH whose breaking candle is a displacement candle
//            (range ≥ 1.5 × ATR with a body-dominated close).
//  A wick through a level is NOT a break. A lone "lower high" or "higher low"
//  is a label, not an event.

export interface StructureOptions {
  lookback?: number;
  /** Displacement threshold as a multiple of ATR. */
  displacementAtr?: number;
}

export function analyzeStructure(candles: Candle[], lookbackOrOpts: number | StructureOptions = 3): MarketStructureResult {
  const opts: StructureOptions = typeof lookbackOrOpts === 'number' ? { lookback: lookbackOrOpts } : lookbackOrOpts;
  const lookback = opts.lookback ?? 3;
  const dispAtr = opts.displacementAtr ?? 1.5;

  const swings = findSwings(candles, lookback);
  const empty: MarketStructureResult = {
    swings, labels: [], events: [], currentBias: 'neutral', state: 'sideways', activeHigh: null, activeLow: null,
  };
  if (swings.length < 4) return empty;

  // ── labels ──
  const labels: MarketStructureResult['labels'] = [];
  let prevHigh: SwingPoint | null = null;
  let prevLow: SwingPoint | null = null;
  for (const sw of swings) {
    if (sw.type === 'high') {
      if (prevHigh) {
        const label: StructureLabel = sw.price > prevHigh.price ? 'HH' : 'LH';
        labels.push({ index: sw.index, label, price: sw.price, time: sw.time });
      }
      prevHigh = sw;
    } else {
      if (prevLow) {
        const label: StructureLabel = sw.price < prevLow.price ? 'LL' : 'HL';
        labels.push({ index: sw.index, label, price: sw.price, time: sw.time });
      }
      prevLow = sw;
    }
  }

  // ── events: walk candles, revealing swings only once confirmed ──
  const atrArr = atrSeries(candles, 14);
  const events: StructureEvent[] = [];
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let activeHigh: SwingPoint | null = null;
  let activeLow: SwingPoint | null = null;

  const byConfirmBar = new Map<number, SwingPoint[]>();
  for (const sw of swings) {
    const k = sw.index + lookback;
    const arr = byConfirmBar.get(k);
    if (arr) arr.push(sw); else byConfirmBar.set(k, [sw]);
  }

  for (let t = 0; t < candles.length; t++) {
    const newly = byConfirmBar.get(t);
    if (newly) {
      for (const sw of newly) {
        if (sw.type === 'high') activeHigh = sw; else activeLow = sw;
      }
    }
    const c = candles[t];
    const a = atrArr[t];
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const displacement = a !== null && range >= dispAtr * a && range > 0 && body / range >= 0.55;

    if (activeHigh && c.close > activeHigh.price) {
      const against = trend === 'bearish';
      events.push({
        type: against ? (displacement ? 'MSS' : 'CHOCH') : 'BOS',
        direction: 'bullish', index: t, time: c.time, price: c.close,
        level: activeHigh.price, levelIndex: activeHigh.index, displacement,
      });
      trend = 'bullish';
      activeHigh = null; // consumed — a new swing high must form before the next break
    } else if (activeLow && c.close < activeLow.price) {
      const against = trend === 'bullish';
      events.push({
        type: against ? (displacement ? 'MSS' : 'CHOCH') : 'BOS',
        direction: 'bearish', index: t, time: c.time, price: c.close,
        level: activeLow.price, levelIndex: activeLow.index, displacement,
      });
      trend = 'bearish';
      activeLow = null;
    }
  }

  // ── state ──
  const recentLabels = labels.slice(-4).map(l => l.label);
  const bullLabels = recentLabels.filter(l => l === 'HH' || l === 'HL').length;
  const bearLabels = recentLabels.filter(l => l === 'LH' || l === 'LL').length;
  const lastEvent = events[events.length - 1];
  const barsSinceEvent = lastEvent ? candles.length - 1 - lastEvent.index : Infinity;
  const lastWasReversal = !!lastEvent && lastEvent.type !== 'BOS';

  let state: StructureState;
  if (lastWasReversal && barsSinceEvent <= 30) state = 'transition';
  else if (trend === 'bullish' && bullLabels >= 2 && bullLabels > bearLabels) state = 'bullish';
  else if (trend === 'bearish' && bearLabels >= 2 && bearLabels > bullLabels) state = 'bearish';
  else if (trend === 'bullish' && bullLabels >= bearLabels && bullLabels > 0) state = 'bullish';
  else if (trend === 'bearish' && bearLabels >= bullLabels && bearLabels > 0) state = 'bearish';
  else state = 'sideways';

  return { swings, labels, events, currentBias: trend, state, activeHigh, activeLow };
}
