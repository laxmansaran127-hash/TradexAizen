import type { Candle } from '@/types/trading';
import type { CandlePattern, SwingPoint, SRLevel, Zone } from './types';
import { currentAtr } from './liquidity';

// ── Candlestick Pattern Detection from OHLC Data ────────────────

function detectRawCandlePatterns(candles: Candle[]): CandlePattern[] {
  if (candles.length < 3) return [];

  const patterns: CandlePattern[] = [];
  const n = candles.length;

  // Check last several candles for patterns
  for (let i = Math.max(2, n - 10); i < n; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];

    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    const upperShadow = curr.high - Math.max(curr.open, curr.close);
    const lowerShadow = Math.min(curr.open, curr.close) - curr.low;
    const isBullish = curr.close > curr.open;
    const isBearish = curr.close < curr.open;

    const prevBody = Math.abs(prev.close - prev.open);
    const prevRange = prev.high - prev.low;
    const prevIsBullish = prev.close > prev.open;
    const prevIsBearish = prev.close < prev.open;

    // Doji
    if (range > 0 && body / range < 0.1) {
      patterns.push({
        name: 'Doji',
        direction: 'neutral',
        index: i,
        time: curr.time,
        description: 'Open and close are nearly equal, indicating market indecision.',
      });
    }

    // Hammer
    if (lowerShadow > body * 2 && upperShadow < body * 0.5 && body > 0 && range > 0) {
      patterns.push({
        name: 'Hammer',
        direction: 'bullish',
        index: i,
        time: curr.time,
        description: 'Small body with a long lower shadow and minimal upper shadow. Suggests buyers rejected lower prices.',
      });
    }

    // Shooting Star
    if (upperShadow > body * 2 && lowerShadow < body * 0.5 && body > 0 && range > 0) {
      patterns.push({
        name: 'Shooting Star',
        direction: 'bearish',
        index: i,
        time: curr.time,
        description: 'Small body with a long upper shadow and minimal lower shadow. Suggests sellers rejected higher prices.',
      });
    }

    // Pin Bar (larger version of hammer/shooting star with more context)
    if (body > 0 && range > 0) {
      const totalShadows = upperShadow + lowerShadow;
      if (totalShadows > body * 3) {
        if (lowerShadow > upperShadow * 3) {
          patterns.push({
            name: 'Bullish Pin Bar',
            direction: 'bullish',
            index: i,
            time: curr.time,
            description: 'A long lower wick with a small body at the top, indicating rejection of lower prices.',
          });
        } else if (upperShadow > lowerShadow * 3) {
          patterns.push({
            name: 'Bearish Pin Bar',
            direction: 'bearish',
            index: i,
            time: curr.time,
            description: 'A long upper wick with a small body at the bottom, indicating rejection of higher prices.',
          });
        }
      }
    }

    // Bullish Engulfing
    if (prevIsBearish && isBullish && curr.close > prev.open && curr.open < prev.close) {
      patterns.push({
        name: 'Bullish Engulfing',
        direction: 'bullish',
        index: i,
        time: curr.time,
        description: 'A bullish candle completely engulfs the previous bearish candle, signaling a potential reversal upward.',
      });
    }

    // Bearish Engulfing
    if (prevIsBullish && isBearish && curr.close < prev.open && curr.open > prev.close) {
      patterns.push({
        name: 'Bearish Engulfing',
        direction: 'bearish',
        index: i,
        time: curr.time,
        description: 'A bearish candle completely engulfs the previous bullish candle, signaling a potential reversal downward.',
      });
    }

    // Morning Star (3-candle pattern)
    if (prev2 && prevIsBearish && prevBody > prevRange * 0.5 &&
        Math.abs(prev.close - prev.open) > 0 &&
        prevBody / prevRange < 0.3 &&
        isBullish && curr.close > prev2.open) {
      patterns.push({
        name: 'Morning Star',
        direction: 'bullish',
        index: i,
        time: curr.time,
        description: 'A three-candle bottom reversal: bearish candle, small-body candle (star), then a bullish candle closing above the first candle\'s open.',
      });
    }

    // Evening Star (3-candle pattern)
    if (prev2 && prevIsBullish && prevBody > prevRange * 0.5 &&
        Math.abs(prev.close - prev.open) > 0 &&
        prevBody / prevRange < 0.3 &&
        isBearish && curr.close < prev2.open) {
      patterns.push({
        name: 'Evening Star',
        direction: 'bearish',
        index: i,
        time: curr.time,
        description: 'A three-candle top reversal: bullish candle, small-body candle (star), then a bearish candle closing below the first candle\'s open.',
      });
    }

    // Marubozu
    if (range > 0 && body / range > 0.9) {
      if (isBullish) {
        patterns.push({
          name: 'Bullish Marubozu',
          direction: 'bullish',
          index: i,
          time: curr.time,
          description: 'A full-body bullish candle with minimal shadows, indicating strong buying pressure.',
        });
      } else if (isBearish) {
        patterns.push({
          name: 'Bearish Marubozu',
          direction: 'bearish',
          index: i,
          time: curr.time,
          description: 'A full-body bearish candle with minimal shadows, indicating strong selling pressure.',
        });
      }
    }
  }

  // Deduplicate — keep only the most recent occurrence of each pattern name
  const seen = new Set<string>();
  const unique = patterns.slice().reverse().filter(p => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });

  return unique.reverse();
}

// ── Refinement: size, trend context and location ────────────────
// Reversal candles only mean something (a) after a move into the level and
// (b) AT a level. Everything else is noise and is discarded, not displayed.

export interface CandleContext {
  swings: SwingPoint[];
  support: SRLevel[];
  resistance: SRLevel[];
  zones: Zone[];
}

const REVERSAL_BULL = new Set(['Hammer', 'Bullish Pin Bar', 'Bullish Engulfing', 'Morning Star']);
const REVERSAL_BEAR = new Set(['Shooting Star', 'Bearish Pin Bar', 'Bearish Engulfing', 'Evening Star']);
const PRIORITY = ['Bullish Engulfing', 'Bearish Engulfing', 'Morning Star', 'Evening Star', 'Bullish Pin Bar', 'Bearish Pin Bar', 'Hammer', 'Shooting Star', 'Inside Bar', 'Doji'];

export function detectCandlePatterns(candles: Candle[], ctx?: CandleContext): CandlePattern[] {
  const n = candles.length;
  if (n < 20) return [];
  const a = currentAtr(candles);
  if (!(a > 0)) return [];
  const raw = detectRawCandlePatterns(candles);

  // Inside bar (not in the raw detector)
  for (let i = Math.max(1, n - 10); i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    if (c.high < p.high && c.low > p.low && p.high - p.low >= 0.8 * a) {
      raw.push({ name: 'Inside Bar', direction: 'neutral', index: i, time: c.time,
        description: 'Range contained within the prior (large) bar — compression; direction is decided by the break.' });
    }
  }

  const near = (price: number, level: number) => Math.abs(price - level) <= 0.3 * a;
  const atSupport = (c: Candle) =>
    !!ctx && (ctx.swings.some(s => s.type === 'low' && near(c.low, s.price)) ||
      ctx.support.some(l => near(c.low, l.price) || (l.zoneLow !== undefined && c.low <= (l.zoneHigh ?? l.price) + 0.3 * a && c.low >= l.zoneLow - 0.3 * a)) ||
      ctx.zones.some(z => z.type === 'demand' && !z.invalidated && c.low <= z.top && c.low >= z.bottom - 0.3 * a));
  const atResistance = (c: Candle) =>
    !!ctx && (ctx.swings.some(s => s.type === 'high' && near(c.high, s.price)) ||
      ctx.resistance.some(l => near(c.high, l.price) || (l.zoneLow !== undefined && c.high >= (l.zoneLow ?? l.price) - 0.3 * a && c.high <= (l.zoneHigh ?? l.price) + 0.3 * a)) ||
      ctx.zones.some(z => z.type === 'supply' && !z.invalidated && c.high >= z.bottom && c.high <= z.top + 0.3 * a));

  const kept: CandlePattern[] = [];
  for (const p of raw) {
    const c = candles[p.index];
    const range = c.high - c.low;
    if (range < 0.6 * a) continue;                                  // micro-candle noise
    if (p.name.endsWith('Marubozu') && range < a) continue;         // only meaningful if large

    const priorMove = candles[p.index - 1].close - candles[Math.max(0, p.index - 4)].close;
    if (REVERSAL_BULL.has(p.name)) {
      if (!(priorMove <= -0.75 * a)) continue;                      // needs a decline INTO it
      const key = atSupport(c);
      if (ctx && !key) continue;                                    // needs location
      kept.push({ ...p, atKeyLevel: key });
    } else if (REVERSAL_BEAR.has(p.name)) {
      if (!(priorMove >= 0.75 * a)) continue;
      const key = atResistance(c);
      if (ctx && !key) continue;
      kept.push({ ...p, atKeyLevel: key });
    } else if (p.name === 'Doji') {
      if (ctx && !(atSupport(c) || atResistance(c))) continue;
      kept.push({ ...p, atKeyLevel: true });
    } else {
      kept.push(p);
    }
  }

  // one pattern per bar+direction: strongest by priority
  const best = new Map<string, CandlePattern>();
  for (const p of kept) {
    const k = `${p.index}:${p.direction}`;
    const cur = best.get(k);
    const rank = (x: CandlePattern) => { const i = PRIORITY.indexOf(x.name); return i === -1 ? 99 : i; };
    if (!cur || rank(p) < rank(cur)) best.set(k, p);
  }
  return Array.from(best.values()).sort((x, y) => y.index - x.index);
}
