import type { Candle, Timeframe } from '@/types/trading';
import type { MtfContext, TimeframeContext } from './types';
import { analyzeStructure } from './swings';
import { ema } from '@/lib/indicators';
import { dropFormingCandle, sanitizeCandles } from '@/lib/data/validation';

// ── Multi-timeframe context ─────────────────────────────────────
// Higher timeframe → direction / context
// Middle timeframe → structure
// Selected (entry) timeframe → confirmation / trigger
// Each series is analysed ON ITS OWN candles; timeframes are never mixed.

export function getContextTimeframes(tf: Timeframe): { middle: Timeframe | null; higher: Timeframe | null } {
  switch (tf) {
    case '1m':  return { middle: '15m', higher: '1H' };
    case '5m':  return { middle: '1H',  higher: '4H' };
    case '15m': return { middle: '1H',  higher: '4H' };
    case '30m': return { middle: '4H',  higher: '1D' };
    case '1H':  return { middle: '4H',  higher: '1D' };
    case '4H':  return { middle: '1D',  higher: null };
    case '1D':  return { middle: null,  higher: null };
  }
}

export function buildTimeframeContext(
  raw: Candle[],
  timeframe: Timeframe,
  role: TimeframeContext['role'],
  opts: { nowSec?: number; maxJump?: number } = {},
): TimeframeContext | null {
  const clean = sanitizeCandles(raw, { timeframe, maxJump: opts.maxJump, nowSec: opts.nowSec }).candles;
  const closed = dropFormingCandle(clean, timeframe, opts.nowSec);
  if (closed.length < 60) return null;

  const st = analyzeStructure(closed);
  const e20 = ema(closed, 20), e50 = ema(closed, 50);
  const l20 = e20[closed.length - 1], l50 = e50[closed.length - 1];
  const price = closed[closed.length - 1].close;
  let trend: TimeframeContext['trend'] = 'sideways';
  if (l20 !== null && l50 !== null) {
    if (l20 > l50 && price > l50) trend = 'bullish';
    else if (l20 < l50 && price < l50) trend = 'bearish';
  }
  const last = st.events[st.events.length - 1];
  return {
    timeframe, role,
    bias: st.state ?? 'sideways',
    trend,
    lastEvent: last ? `${last.type} ${last.direction}` : undefined,
    keyHigh: st.activeHigh?.price,
    keyLow: st.activeLow?.price,
    candles: closed.length,
  };
}

function direction(c: TimeframeContext | null): 'bullish' | 'bearish' | 'neutral' {
  if (!c) return 'neutral';
  if (c.bias === 'bullish') return 'bullish';
  if (c.bias === 'bearish') return 'bearish';
  if (c.bias === 'transition') {
    // direction of the most recent reversal event
    if (c.lastEvent?.includes('bullish')) return 'bullish';
    if (c.lastEvent?.includes('bearish')) return 'bearish';
  }
  if (c.bias === 'sideways') return c.trend === 'sideways' ? 'neutral' : c.trend;
  return 'neutral';
}

export function combineMtf(
  entry: TimeframeContext,
  middle: TimeframeContext | null,
  higher: TimeframeContext | null,
): MtfContext {
  const notes: string[] = [];
  const e = direction(entry), m = direction(middle), h = direction(higher);
  const lead = higher ? h : middle ? m : null;

  if (!higher && !middle) {
    notes.push('No higher-timeframe data available — context cannot be confirmed');
    return { higher, middle, entry, alignment: 'unavailable', notes };
  }
  if (higher) notes.push(`${higher.timeframe} (direction): ${higher.bias}${higher.lastEvent ? `, last ${higher.lastEvent}` : ''}, EMA trend ${higher.trend}`);
  else notes.push('No higher timeframe above this one');
  if (middle) notes.push(`${middle.timeframe} (structure): ${middle.bias}${middle.lastEvent ? `, last ${middle.lastEvent}` : ''}`);
  notes.push(`${entry.timeframe} (entry): ${entry.bias}${entry.lastEvent ? `, last ${entry.lastEvent}` : ''}`);

  let alignment: MtfContext['alignment'] = 'partial';
  if (lead && lead !== 'neutral' && e !== 'neutral' && lead !== e) alignment = 'conflicting';
  else if (lead && lead !== 'neutral' && lead === e && (m === 'neutral' || m === lead || !middle)) {
    alignment = lead === 'bullish' ? 'aligned-bullish' : 'aligned-bearish';
  } else if (middle && m !== 'neutral' && h !== 'neutral' && m !== h) alignment = 'conflicting';
  return { higher, middle, entry, alignment, notes };
}
