import type { Candle } from '@/types/trading';
import type { IndicatorConfig } from './types';

// ── Technical Indicator Calculations ────────────────────────────
// All functions return arrays aligned to the input candle length, with `null`
// for positions where the indicator value is not yet available.

export interface IndicatorResult {
  values: (number | null)[];
  values2?: (number | null)[]; // for MACD signal, Bollinger lower, Stoch D
  values3?: (number | null)[]; // for MACD histogram, Bollinger upper
  lines: { name: string; values: (number | null)[]; color: string }[];
}

export function sma(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += candles[i - j].close;
    out.push(sum / period);
  }
  return out;
}

export function ema(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += candles[i - j].close;
      prev = sum / period;
      out.push(prev);
      continue;
    }
    prev = candles[i].close * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/**
 * Session VWAP — resets at each UTC day boundary (the standard anchoring for
 * 24h markets). Returns null for bars with no real volume (spot FX / gold feeds
 * carry none) and for daily-or-higher series, where a session VWAP is
 * meaningless. The previous implementation accumulated across the entire loaded
 * window, which made its value depend on how many candles happened to load.
 */
export function vwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = [];
  if (candles.length >= 2 && candles[1].time - candles[0].time >= 86400) {
    return candles.map(() => null);
  }
  let cumPV = 0, cumV = 0, day = -1;
  for (const c of candles) {
    const d = Math.floor(c.time / 86400);
    if (d !== day) { day = d; cumPV = 0; cumV = 0; }
    const vol = c.volume ?? 0;
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * vol;
    cumV += vol;
    out.push(cumV > 0 ? cumPV / cumV : null);
  }
  return out;
}

export function rsi(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let gains = 0, losses = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { out.push(null); continue; }
    const change = candles[i].close - candles[i - 1].close;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);

    if (i <= period) {
      gains += gain;
      losses += loss;
      if (i === period) {
        // Seed Wilder smoothing with the simple AVERAGE (previously the raw sum was
        // carried forward, skewing every RSI value after the first).
        gains = gains / period;
        losses = losses / period;
        out.push(losses === 0 ? 100 : 100 - 100 / (1 + gains / losses));
      } else {
        out.push(null);
      }
    } else {
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
      out.push(losses === 0 ? 100 : 100 - 100 / (1 + gains / losses));
    }
  }
  return out;
}

export function macd(candles: Candle[], fast: number, slow: number, signal: number) {
  const emaFast = ema(candles, fast);
  const emaSlow = ema(candles, slow);
  const macdLine: (number | null)[] = candles.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i]! - emaSlow[i]!) : null
  );

  // Signal = EMA of MACD line (only over non-null region)
  const firstValid = macdLine.findIndex(v => v !== null);
  const signalLine: (number | null)[] = new Array(candles.length).fill(null);
  if (firstValid >= 0) {
    const k = 2 / (signal + 1);
    let prev: number | null = null;
    for (let i = firstValid; i < candles.length; i++) {
      const v = macdLine[i]!;
      if (prev === null) {
        const slice: number[] = [];
        for (let j = firstValid; j <= i && slice.length < signal; j++) {
          if (macdLine[j] !== null) slice.push(macdLine[j]!);
        }
        if (slice.length >= signal) {
          prev = slice.slice(-signal).reduce((a, b) => a + b, 0) / signal;
          signalLine[i] = prev;
        }
      } else {
        prev = v * k + prev * (1 - k);
        signalLine[i] = prev;
      }
    }
  }

  const histogram: (number | null)[] = candles.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null ? macdLine[i]! - signalLine[i]! : null
  );

  return { macdLine, signalLine, histogram };
}

export function bollinger(candles: Candle[], period: number, mult: number) {
  const mid = sma(candles, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1 || mid[i] === null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = 0; j < period; j++) sumSq += Math.pow(candles[i - j].close - mid[i]!, 2);
    const sd = Math.sqrt(sumSq / period);
    upper.push(mid[i]! + mult * sd);
    lower.push(mid[i]! - mult * sd);
  }
  return { mid, upper, lower };
}

export function atr(candles: Candle[], period: number): (number | null)[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { tr.push(candles[i].high - candles[i].low); continue; }
    const v = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    tr.push(v);
  }
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (prev === null) {
      prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out.push(prev);
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
      out.push(prev);
    }
  }
  return out;
}

export function stochastic(candles: Candle[], kPeriod: number, dPeriod: number) {
  const k: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) { k.push(null); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < kPeriod; j++) {
      hh = Math.max(hh, candles[i - j].high);
      ll = Math.min(ll, candles[i - j].low);
    }
    k.push(hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100);
  }
  // D = SMA of K
  const d: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1 + dPeriod - 1) { d.push(null); continue; }
    let sum = 0, cnt = 0;
    for (let j = 0; j < dPeriod; j++) {
      const v = k[i - j];
      if (v !== null) { sum += v; cnt++; }
    }
    d.push(cnt === dPeriod ? sum / dPeriod : null);
  }
  return { k, d };
}

// ── ADX (Average Directional Index) ───────────────────────────
// Returns +DI, -DI, and ADX arrays. ADX measures trend strength
// regardless of direction. >25 = trending, <20 = ranging.

export function adx(candles: Candle[], period: number): {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
} {
  const len = candles.length;
  const plusDM: number[] = new Array(len).fill(0);
  const minusDM: number[] = new Array(len).fill(0);
  const tr: number[] = new Array(len).fill(0);

  for (let i = 1; i < len; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }

  // Wilder's smoothing
  const smoothTR: (number | null)[] = new Array(len).fill(null);
  const smoothPlusDM: (number | null)[] = new Array(len).fill(null);
  const smoothMinusDM: (number | null)[] = new Array(len).fill(null);
  const plusDI: (number | null)[] = new Array(len).fill(null);
  const minusDI: (number | null)[] = new Array(len).fill(null);
  const dx: (number | null)[] = new Array(len).fill(null);
  const adxArr: (number | null)[] = new Array(len).fill(null);

  if (len < period + 1) {
    return { adx: adxArr, plusDI, minusDI };
  }

  let trSum = 0, plusSum = 0, minusSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += tr[i];
    plusSum += plusDM[i];
    minusSum += minusDM[i];
  }
  smoothTR[period] = trSum;
  smoothPlusDM[period] = plusSum;
  smoothMinusDM[period] = minusSum;

  for (let i = period + 1; i < len; i++) {
    smoothTR[i] = smoothTR[i - 1]! - smoothTR[i - 1]! / period + tr[i];
    smoothPlusDM[i] = smoothPlusDM[i - 1]! - smoothPlusDM[i - 1]! / period + plusDM[i];
    smoothMinusDM[i] = smoothMinusDM[i - 1]! - smoothMinusDM[i - 1]! / period + minusDM[i];
  }

  for (let i = period; i < len; i++) {
    if (smoothTR[i] !== null && smoothTR[i]! > 0) {
      plusDI[i] = (smoothPlusDM[i]! / smoothTR[i]!) * 100;
      minusDI[i] = (smoothMinusDM[i]! / smoothTR[i]!) * 100;
    }
    if (plusDI[i] !== null && minusDI[i] !== null) {
      const sum = plusDI[i]! + minusDI[i]!;
      dx[i] = sum > 0 ? (Math.abs(plusDI[i]! - minusDI[i]!) / sum) * 100 : 0;
    }
  }

  // ADX = Wilder's smoothing of DX, starting after `period` DX values
  const firstDX = dx.findIndex(v => v !== null);
  if (firstDX >= 0 && firstDX + period - 1 < len) {
    let adxSum = 0;
    let count = 0;
    for (let i = firstDX; i < len && count < period; i++) {
      if (dx[i] !== null) { adxSum += dx[i]!; count++; }
    }
    if (count === period) {
      const adxStartIdx = firstDX + period - 1;
      adxArr[adxStartIdx] = adxSum / period;
      let prev = adxArr[adxStartIdx]!;
      for (let i = adxStartIdx + 1; i < len; i++) {
        if (dx[i] === null) continue;
        prev = (prev * (period - 1) + dx[i]!) / period;
        adxArr[i] = prev;
      }
    }
  }

  return { adx: adxArr, plusDI, minusDI };
}

// ── Stochastic RSI ─────────────────────────────────────────────
// Applies Stochastic oscillator formula to RSI values rather than
// price. Returns %K and %D lines.

export function stochasticRsi(
  candles: Candle[],
  rsiPeriod: number,
  stochPeriod: number,
  smoothK: number,
  smoothD: number,
): { k: (number | null)[]; d: (number | null)[] } {
  const rsiArr = rsi(candles, rsiPeriod);
  const len = candles.length;
  const rawK: (number | null)[] = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    if (i < rsiPeriod + stochPeriod - 1) continue;
    let minRSI = Infinity;
    let maxRSI = -Infinity;
    let hasNull = false;
    for (let j = 0; j < stochPeriod; j++) {
      const v = rsiArr[i - j];
      if (v === null) { hasNull = true; break; }
      minRSI = Math.min(minRSI, v);
      maxRSI = Math.max(maxRSI, v);
    }
    if (hasNull || maxRSI === minRSI) {
      rawK[i] = 0;
    } else {
      const currentRSI = rsiArr[i]!;
      rawK[i] = ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100;
    }
  }

  // Smooth K with SMA
  const k: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (i < rsiPeriod + stochPeriod - 1 + smoothK - 1) continue;
    let sum = 0, cnt = 0;
    for (let j = 0; j < smoothK; j++) {
      if (rawK[i - j] !== null) { sum += rawK[i - j]!; cnt++; }
    }
    if (cnt === smoothK) k[i] = sum / smoothK;
  }

  // D = SMA of smoothed K
  const d: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (k[i] === null) continue;
    if (i < rsiPeriod + stochPeriod - 1 + smoothK - 1 + smoothD - 1) continue;
    let sum = 0, cnt = 0;
    for (let j = 0; j < smoothD; j++) {
      if (k[i - j] !== null) { sum += k[i - j]!; cnt++; }
    }
    if (cnt === smoothD) d[i] = sum / smoothD;
  }

  return { k, d };
}

export function supertrend(candles: Candle[], period: number, mult: number): (number | null)[] {
  const a = atr(candles, period);
  const trend: (number | null)[] = [];
  let prevUpper = 0, prevLower = 0, dir = 1;

  for (let i = 0; i < candles.length; i++) {
    if (a[i] === null) { trend.push(null); continue; }
    const hl2 = (candles[i].high + candles[i].low) / 2;
    let upper = hl2 + mult * a[i]!;
    let lower = hl2 - mult * a[i]!;

    if (i > 0 && trend[i - 1] !== null) {
      upper = (upper < prevUpper || candles[i - 1].close > prevUpper) ? upper : prevUpper;
      lower = (lower > prevLower || candles[i - 1].close < prevLower) ? lower : prevLower;
    }

    if (dir === 1 && candles[i].close < lower) dir = -1;
    else if (dir === -1 && candles[i].close > upper) dir = 1;

    trend.push(dir === 1 ? lower : upper);
    prevUpper = upper;
    prevLower = lower;
  }
  return trend;
}

// ── Calculate indicator from config ─────────────────────────────

export function calculateIndicator(candles: Candle[], cfg: IndicatorConfig): IndicatorResult {
  switch (cfg.type) {
    case 'SMA': {
      const v = sma(candles, cfg.period);
      return { values: v, lines: [{ name: `SMA ${cfg.period}`, values: v, color: cfg.color }] };
    }
    case 'EMA': {
      const v = ema(candles, cfg.period);
      return { values: v, lines: [{ name: `EMA ${cfg.period}`, values: v, color: cfg.color }] };
    }
    case 'VWAP': {
      const v = vwap(candles);
      return { values: v, lines: [{ name: 'VWAP', values: v, color: cfg.color }] };
    }
    case 'RSI': {
      const v = rsi(candles, cfg.period);
      return { values: v, lines: [{ name: `RSI ${cfg.period}`, values: v, color: cfg.color }] };
    }
    case 'MACD': {
      const r = macd(candles, 12, 26, 9);
      return {
        values: r.macdLine, values2: r.signalLine, values3: r.histogram,
        lines: [
          { name: 'MACD', values: r.macdLine, color: cfg.color },
          { name: 'Signal', values: r.signalLine, color: '#f59e0b' },
          { name: 'Hist', values: r.histogram, color: '#6b7280' },
        ],
      };
    }
    case 'BOLL': {
      const r = bollinger(candles, cfg.period, 2);
      return {
        values: r.mid, values2: r.lower, values3: r.upper,
        lines: [
          { name: 'BB Upper', values: r.upper, color: cfg.color },
          { name: 'BB Mid', values: r.mid, color: '#6b7280' },
          { name: 'BB Lower', values: r.lower, color: cfg.color },
        ],
      };
    }
    case 'ATR': {
      const v = atr(candles, cfg.period);
      return { values: v, lines: [{ name: `ATR ${cfg.period}`, values: v, color: cfg.color }] };
    }
    case 'STOCH': {
      const r = stochastic(candles, cfg.period, 3);
      return {
        values: r.k, values2: r.d,
        lines: [
          { name: `%K ${cfg.period}`, values: r.k, color: cfg.color },
          { name: '%D', values: r.d, color: '#f59e0b' },
        ],
      };
    }
    case 'SUPERTREND': {
      const v = supertrend(candles, cfg.period, 3);
      return { values: v, lines: [{ name: `Supertrend ${cfg.period}`, values: v, color: cfg.color }] };
    }
    case 'VOLUME': {
      const v = candles.map(c => c.volume ?? 0);
      return { values: v, lines: [{ name: 'Volume', values: v, color: cfg.color }] };
    }
    default:
      return { values: [], lines: [] };
  }
}
