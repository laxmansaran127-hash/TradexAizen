import type { Candle } from '@/types/trading';
import type { ChartPattern } from './types';
import { currentAtr } from './liquidity';

// Volatility scale (ATR as a fraction of price). Original thresholds were tuned for
// ~0.5% ATR (BTC 1H); they are now expressed as multiples of the measured value.
let VOL = 0.005;
const vol = (k: number) => Math.max(VOL * k, 0.0002 * k);

// ── Chart Pattern Detection from OHLC Data ──────────────────────
// Each detector works on real candle data and returns null if insufficient evidence.

export function detectChartPatterns(candles: Candle[]): ChartPattern[] {
  if (candles.length < 30) return [];
  const lastClose = candles[candles.length - 1].close;
  const a = currentAtr(candles);
  if (a > 0 && lastClose > 0) VOL = a / lastClose;

  const patterns: ChartPattern[] = [];

  const dt = detectDoubleTop(candles);
  if (dt) patterns.push(dt);

  const db = detectDoubleBottom(candles);
  if (db) patterns.push(db);

  const hs = detectHeadAndShoulders(candles);
  if (hs) patterns.push(hs);

  const ihs = detectInverseHeadAndShoulders(candles);
  if (ihs) patterns.push(ihs);

  const bf = detectBullFlag(candles);
  if (bf) patterns.push(bf);

  const brf = detectBearFlag(candles);
  if (brf) patterns.push(brf);

  const at = detectAscendingTriangle(candles);
  if (at) patterns.push(at);

  const dt2 = detectDescendingTriangle(candles);
  if (dt2) patterns.push(dt2);

  const ch = detectCupAndHandle(candles);
  if (ch) patterns.push(ch);

  const ich = detectInvertedCupAndHandle(candles);
  if (ich) patterns.push(ich);

  const wedge = detectWedge(candles);
  if (wedge) patterns.push(wedge);

  const channel = detectChannel(candles);
  if (channel) patterns.push(channel);

  return patterns;
}

// ── Helpers ─────────────────────────────────────────────────────

function findRecentSwingHighs(candles: Candle[], count: number, lookback: number): { index: number; price: number; time: number }[] {
  const highs: { index: number; price: number; time: number }[] = [];
  for (let i = candles.length - lookback; i < candles.length - 2; i++) {
    if (i < 2) continue;
    let isHigh = true;
    for (let j = 1; j <= 2; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high, time: candles[i].time });
    if (highs.length >= count) break;
  }
  return highs;
}

function findRecentSwingLows(candles: Candle[], count: number, lookback: number): { index: number; price: number; time: number }[] {
  const lows: { index: number; price: number; time: number }[] = [];
  for (let i = candles.length - lookback; i < candles.length - 2; i++) {
    if (i < 2) continue;
    let isLow = true;
    for (let j = 1; j <= 2; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) lows.push({ index: i, price: candles[i].low, time: candles[i].time });
    if (lows.length >= count) break;
  }
  return lows;
}

// ── Double Top ──────────────────────────────────────────────────

function detectDoubleTop(candles: Candle[]): ChartPattern | null {
  const highs = findRecentSwingHighs(candles, 2, 60);
  if (highs.length < 2) return null;

  const h1 = highs[0];
  const h2 = highs[1];
  const tolerance = vol(1);
  const avgPrice = (h1.price + h2.price) / 2;

  if (Math.abs(h1.price - h2.price) / avgPrice > tolerance) return null;

  const valley = Math.min(...candles.slice(h1.index, h2.index).map(c => c.low));
  const neckline = valley;
  const lastClose = candles[candles.length - 1].close;

  if (lastClose > neckline) return null;

  return {
    name: 'Double Top',
    direction: 'bearish',
    startIndex: h1.index,
    endIndex: candles.length - 1,
    confidence: 0.7,
    keyLevels: [
      { label: 'Peak 1', price: h1.price, index: h1.index, time: h1.time },
      { label: 'Valley (Neckline)', price: neckline, index: h1.index + Math.floor((h2.index - h1.index) / 2), time: candles[h1.index + Math.floor((h2.index - h1.index) / 2)].time },
      { label: 'Peak 2', price: h2.price, index: h2.index, time: h2.time },
    ],
    description: 'Two consecutive highs at approximately the same price level, followed by a break below the neckline.',
    confirmed: lastClose < neckline,
  };
}

// ── Double Bottom ───────────────────────────────────────────────

function detectDoubleBottom(candles: Candle[]): ChartPattern | null {
  const lows = findRecentSwingLows(candles, 2, 60);
  if (lows.length < 2) return null;

  const l1 = lows[0];
  const l2 = lows[1];
  const tolerance = vol(1);
  const avgPrice = (l1.price + l2.price) / 2;

  if (Math.abs(l1.price - l2.price) / avgPrice > tolerance) return null;

  const peak = Math.max(...candles.slice(l1.index, l2.index).map(c => c.high));
  const neckline = peak;
  const lastClose = candles[candles.length - 1].close;

  if (lastClose < neckline) return null;

  return {
    name: 'Double Bottom',
    direction: 'bullish',
    startIndex: l1.index,
    endIndex: candles.length - 1,
    confidence: 0.7,
    keyLevels: [
      { label: 'Trough 1', price: l1.price, index: l1.index, time: l1.time },
      { label: 'Peak (Neckline)', price: neckline, index: l1.index + Math.floor((l2.index - l1.index) / 2), time: candles[l1.index + Math.floor((l2.index - l1.index) / 2)].time },
      { label: 'Trough 2', price: l2.price, index: l2.index, time: l2.time },
    ],
    description: 'Two consecutive lows at approximately the same price level, followed by a break above the neckline.',
    confirmed: lastClose > neckline,
  };
}

// ── Head and Shoulders ──────────────────────────────────────────

function detectHeadAndShoulders(candles: Candle[]): ChartPattern | null {
  const highs = findRecentSwingHighs(candles, 3, 80);
  if (highs.length < 3) return null;

  const [s1, head, s2] = highs;
  if (head.price <= s1.price || head.price <= s2.price) return null;

  const tolerance = vol(2);
  if (Math.abs(s1.price - s2.price) / s1.price > tolerance) return null;

  const neckline = Math.min(
    Math.min(...candles.slice(s1.index, head.index).map(c => c.low)),
    Math.min(...candles.slice(head.index, s2.index).map(c => c.low))
  );
  const lastClose = candles[candles.length - 1].close;

  return {
    name: 'Head and Shoulders',
    direction: 'bearish',
    startIndex: s1.index,
    endIndex: candles.length - 1,
    confidence: 0.8,
    keyLevels: [
      { label: 'Left Shoulder', price: s1.price, index: s1.index, time: s1.time },
      { label: 'Head', price: head.price, index: head.index, time: head.time },
      { label: 'Right Shoulder', price: s2.price, index: s2.index, time: s2.time },
      { label: 'Neckline', price: neckline, index: s2.index, time: s2.time },
    ],
    description: 'Three peaks with the center peak (head) highest and two side peaks (shoulders) at similar levels. A break below the neckline confirms the pattern.',
    confirmed: lastClose < neckline,
  };
}

// ── Inverse Head and Shoulders ──────────────────────────────────

function detectInverseHeadAndShoulders(candles: Candle[]): ChartPattern | null {
  const lows = findRecentSwingLows(candles, 3, 80);
  if (lows.length < 3) return null;

  const [s1, head, s2] = lows;
  if (head.price >= s1.price || head.price >= s2.price) return null;

  const tolerance = vol(2);
  if (Math.abs(s1.price - s2.price) / s1.price > tolerance) return null;

  const neckline = Math.max(
    Math.max(...candles.slice(s1.index, head.index).map(c => c.high)),
    Math.max(...candles.slice(head.index, s2.index).map(c => c.high))
  );
  const lastClose = candles[candles.length - 1].close;

  return {
    name: 'Inverse Head and Shoulders',
    direction: 'bullish',
    startIndex: s1.index,
    endIndex: candles.length - 1,
    confidence: 0.8,
    keyLevels: [
      { label: 'Left Shoulder', price: s1.price, index: s1.index, time: s1.time },
      { label: 'Head', price: head.price, index: head.index, time: head.time },
      { label: 'Right Shoulder', price: s2.price, index: s2.index, time: s2.time },
      { label: 'Neckline', price: neckline, index: s2.index, time: s2.time },
    ],
    description: 'Three troughs with the center trough (head) lowest and two side troughs (shoulders) at similar levels. A break above the neckline confirms the pattern.',
    confirmed: lastClose > neckline,
  };
}

// ── Bull Flag ───────────────────────────────────────────────────

function detectBullFlag(candles: Candle[]): ChartPattern | null {
  const lookback = 30;
  if (candles.length < lookback) return null;

  const flagPole = candles.slice(-lookback, -10);
  const flagArea = candles.slice(-10);

  const poleStart = flagPole[0].close;
  const poleEnd = flagPole[flagPole.length - 1].close;
  const poleMove = (poleEnd - poleStart) / poleStart;

  if (poleMove < vol(6)) return null;

  // Flag should be a slight downward consolidation
  const flagHigh = Math.max(...flagArea.map(c => c.high));
  const flagLow = Math.min(...flagArea.map(c => c.low));
  const flagRange = (flagHigh - flagLow) / poleEnd;

  if (flagRange > vol(6)) return null;

  const flagStartClose = flagArea[0].close;
  const flagEndClose = flagArea[flagArea.length - 1].close;
  if (flagEndClose > flagStartClose * 1.01) return null;

  return {
    name: 'Bull Flag',
    direction: 'bullish',
    startIndex: candles.length - lookback,
    endIndex: candles.length - 1,
    confidence: 0.65,
    keyLevels: [
      { label: 'Pole Start', price: poleStart, index: candles.length - lookback, time: candles[candles.length - lookback].time },
      { label: 'Pole End', price: poleEnd, index: candles.length - 10, time: candles[candles.length - 10].time },
      { label: 'Flag Resistance', price: flagHigh, index: candles.length - 1, time: candles[candles.length - 1].time },
      { label: 'Flag Support', price: flagLow, index: candles.length - 1, time: candles[candles.length - 1].time },
    ],
    description: 'A strong upward move (flagpole) followed by a slight downward consolidation (flag). A breakout above the flag resistance confirms the continuation.',
    confirmed: candles[candles.length - 1].close > flagHigh,
  };
}

// ── Bear Flag ───────────────────────────────────────────────────

function detectBearFlag(candles: Candle[]): ChartPattern | null {
  const lookback = 30;
  if (candles.length < lookback) return null;

  const flagPole = candles.slice(-lookback, -10);
  const flagArea = candles.slice(-10);

  const poleStart = flagPole[0].close;
  const poleEnd = flagPole[flagPole.length - 1].close;
  const poleMove = (poleEnd - poleStart) / poleStart;

  if (poleMove > -vol(6)) return null;

  const flagHigh = Math.max(...flagArea.map(c => c.high));
  const flagLow = Math.min(...flagArea.map(c => c.low));
  const flagRange = (flagHigh - flagLow) / poleEnd;

  if (flagRange > vol(6)) return null;

  const flagStartClose = flagArea[0].close;
  const flagEndClose = flagArea[flagArea.length - 1].close;
  if (flagEndClose < flagStartClose * 0.99) return null;

  return {
    name: 'Bear Flag',
    direction: 'bearish',
    startIndex: candles.length - lookback,
    endIndex: candles.length - 1,
    confidence: 0.65,
    keyLevels: [
      { label: 'Pole Start', price: poleStart, index: candles.length - lookback, time: candles[candles.length - lookback].time },
      { label: 'Pole End', price: poleEnd, index: candles.length - 10, time: candles[candles.length - 10].time },
      { label: 'Flag Resistance', price: flagHigh, index: candles.length - 1, time: candles[candles.length - 1].time },
      { label: 'Flag Support', price: flagLow, index: candles.length - 1, time: candles[candles.length - 1].time },
    ],
    description: 'A strong downward move (flagpole) followed by a slight upward consolidation (flag). A breakout below the flag support confirms the continuation.',
    confirmed: candles[candles.length - 1].close < flagLow,
  };
}

// ── Ascending Triangle ──────────────────────────────────────────

function detectAscendingTriangle(candles: Candle[]): ChartPattern | null {
  const lookback = 40;
  if (candles.length < lookback) return null;

  const recent = candles.slice(-lookback);
  const highs = findRecentSwingHighs(candles, 2, lookback);
  const lows = findRecentSwingLows(candles, 2, lookback);

  if (highs.length < 2 || lows.length < 2) return null;

  // Flat resistance + rising support
  const resistance = (highs[0].price + highs[1].price) / 2;
  if (Math.abs(highs[0].price - highs[1].price) / resistance > vol(1)) return null;

  if (lows[0].price >= lows[1].price) return null;

  const lastClose = candles[candles.length - 1].close;

  return {
    name: 'Ascending Triangle',
    direction: 'bullish',
    startIndex: candles.length - lookback,
    endIndex: candles.length - 1,
    confidence: 0.6,
    keyLevels: [
      { label: 'Flat Resistance', price: resistance, index: highs[0].index, time: highs[0].time },
      { label: 'Rising Support 1', price: lows[0].price, index: lows[0].index, time: lows[0].time },
      { label: 'Rising Support 2', price: lows[1].price, index: lows[1].index, time: lows[1].time },
    ],
    description: 'A horizontal resistance line with a rising support line. Price consolidates upward, typically resolving in a bullish breakout.',
    confirmed: lastClose > resistance,
  };
}

// ── Descending Triangle ─────────────────────────────────────────

function detectDescendingTriangle(candles: Candle[]): ChartPattern | null {
  const lookback = 40;
  if (candles.length < lookback) return null;

  const highs = findRecentSwingHighs(candles, 2, lookback);
  const lows = findRecentSwingLows(candles, 2, lookback);

  if (highs.length < 2 || lows.length < 2) return null;

  // Flat support + descending resistance
  const support = (lows[0].price + lows[1].price) / 2;
  if (Math.abs(lows[0].price - lows[1].price) / support > vol(1)) return null;

  if (highs[0].price <= highs[1].price) return null;

  const lastClose = candles[candles.length - 1].close;

  return {
    name: 'Descending Triangle',
    direction: 'bearish',
    startIndex: candles.length - lookback,
    endIndex: candles.length - 1,
    confidence: 0.6,
    keyLevels: [
      { label: 'Flat Support', price: support, index: lows[0].index, time: lows[0].time },
      { label: 'Descending Resistance 1', price: highs[0].price, index: highs[0].index, time: highs[0].time },
      { label: 'Descending Resistance 2', price: highs[1].price, index: highs[1].index, time: highs[1].time },
    ],
    description: 'A horizontal support line with a descending resistance line. Price consolidates downward, typically resolving in a bearish breakout.',
    confirmed: lastClose < support,
  };
}

// ── Cup and Handle ──────────────────────────────────────────────

function detectCupAndHandle(candles: Candle[]): ChartPattern | null {
  const lookback = 80;
  if (candles.length < lookback) return null;

  const recent = candles.slice(-lookback);
  const cupStart = recent[0];
  const cupEnd = recent[Math.floor(recent.length * 0.75)];

  const cupLow = Math.min(...recent.slice(0, Math.floor(recent.length * 0.75)).map(c => c.low));
  const rimLevel = cupStart.high;

  // Cup should be U-shaped: start high, dip low, return to rim
  if (cupEnd.close < rimLevel * 0.97) return null;
  if (cupLow > rimLevel * 0.95) return null;

  // Handle: small pullback near the rim
  const handle = recent.slice(Math.floor(recent.length * 0.75));
  const handleLow = Math.min(...handle.map(c => c.low));
  const handleHigh = Math.max(...handle.map(c => c.high));

  if (handleLow < rimLevel * 0.93) return null;

  return {
    name: 'Cup and Handle',
    direction: 'bullish',
    startIndex: candles.length - lookback,
    endIndex: candles.length - 1,
    confidence: 0.55,
    keyLevels: [
      { label: 'Cup Rim', price: rimLevel, index: candles.length - lookback, time: cupStart.time },
      { label: 'Cup Bottom', price: cupLow, index: candles.length - lookback + Math.floor(recent.length * 0.4), time: recent[Math.floor(recent.length * 0.4)].time },
      { label: 'Handle Low', price: handleLow, index: candles.length - handle.length, time: handle[0].time },
      { label: 'Handle High', price: handleHigh, index: candles.length - 1, time: candles[candles.length - 1].time },
    ],
    description: 'A U-shaped price formation followed by a small downward drift (handle). A breakout above the handle confirms the bullish continuation.',
    confirmed: candles[candles.length - 1].close > handleHigh,
  };
}

// ── Inverted Cup and Handle ─────────────────────────────────────

function detectInvertedCupAndHandle(candles: Candle[]): ChartPattern | null {
  const lookback = 80;
  if (candles.length < lookback) return null;

  const recent = candles.slice(-lookback);
  const cupStart = recent[0];
  const cupEnd = recent[Math.floor(recent.length * 0.75)];

  const cupHigh = Math.max(...recent.slice(0, Math.floor(recent.length * 0.75)).map(c => c.high));
  const rimLevel = cupStart.low;

  if (cupEnd.close > rimLevel * 1.03) return null;
  if (cupHigh < rimLevel * 1.05) return null;

  const handle = recent.slice(Math.floor(recent.length * 0.75));
  const handleLow = Math.min(...handle.map(c => c.low));
  const handleHigh = Math.max(...handle.map(c => c.high));

  if (handleHigh > rimLevel * 1.07) return null;

  return {
    name: 'Inverted Cup and Handle',
    direction: 'bearish',
    startIndex: candles.length - lookback,
    endIndex: candles.length - 1,
    confidence: 0.5,
    keyLevels: [
      { label: 'Cup Rim', price: rimLevel, index: candles.length - lookback, time: cupStart.time },
      { label: 'Cup Top', price: cupHigh, index: candles.length - lookback + Math.floor(recent.length * 0.4), time: recent[Math.floor(recent.length * 0.4)].time },
      { label: 'Handle High', price: handleHigh, index: candles.length - handle.length, time: handle[0].time },
      { label: 'Handle Low', price: handleLow, index: candles.length - 1, time: candles[candles.length - 1].time },
    ],
    description: 'An inverted U-shape followed by a small upward drift (handle). A breakdown below the handle confirms the bearish continuation.',
    confirmed: candles[candles.length - 1].close < handleLow,
  };
}

// ── Wedge Detection ─────────────────────────────────────────────

function detectWedge(candles: Candle[]): ChartPattern | null {
  const lookback = 50;
  if (candles.length < lookback) return null;

  const highs = findRecentSwingHighs(candles, 3, lookback);
  const lows = findRecentSwingLows(candles, 3, lookback);

  if (highs.length < 3 || lows.length < 3) return null;

  // Fit trendlines
  const highSlope = (highs[highs.length - 1].price - highs[0].price) / (highs[highs.length - 1].index - highs[0].index);
  const lowSlope = (lows[lows.length - 1].price - lows[0].price) / (lows[lows.length - 1].index - lows[0].index);

  // Rising wedge: both lines up, high slope < low slope (converging)
  if (highSlope > 0 && lowSlope > 0 && highSlope < lowSlope) {
    return {
      name: 'Rising Wedge',
      direction: 'bearish',
      startIndex: candles.length - lookback,
      endIndex: candles.length - 1,
      confidence: 0.55,
      keyLevels: [
        { label: 'Upper Trend', price: highs[0].price, index: highs[0].index, time: highs[0].time },
        { label: 'Lower Trend', price: lows[0].price, index: lows[0].index, time: lows[0].time },
        { label: 'Apex Area', price: candles[candles.length - 1].close, index: candles.length - 1, time: candles[candles.length - 1].time },
      ],
      description: 'Two converging upward trendlines. Price tightens upward, typically resolving in a bearish breakdown.',
      confirmed: false,
    };
  }

  // Falling wedge: both lines down, high slope > low slope (converging downward)
  if (highSlope < 0 && lowSlope < 0 && highSlope > lowSlope) {
    return {
      name: 'Falling Wedge',
      direction: 'bullish',
      startIndex: candles.length - lookback,
      endIndex: candles.length - 1,
      confidence: 0.55,
      keyLevels: [
        { label: 'Upper Trend', price: highs[0].price, index: highs[0].index, time: highs[0].time },
        { label: 'Lower Trend', price: lows[0].price, index: lows[0].index, time: lows[0].time },
        { label: 'Apex Area', price: candles[candles.length - 1].close, index: candles.length - 1, time: candles[candles.length - 1].time },
      ],
      description: 'Two converging downward trendlines. Price tightens downward, typically resolving in a bullish breakout.',
      confirmed: false,
    };
  }

  return null;
}

// ── Channel Detection ───────────────────────────────────────────

function detectChannel(candles: Candle[]): ChartPattern | null {
  const lookback = 50;
  if (candles.length < lookback) return null;

  const highs = findRecentSwingHighs(candles, 3, lookback);
  const lows = findRecentSwingLows(candles, 3, lookback);

  if (highs.length < 3 || lows.length < 3) return null;

  const highSlope = (highs[highs.length - 1].price - highs[0].price) / (highs[highs.length - 1].index - highs[0].index);
  const lowSlope = (lows[lows.length - 1].price - lows[0].price) / (lows[lows.length - 1].index - lows[0].index);

  // Parallel channel: slopes are roughly equal
  const slopeDiff = Math.abs(highSlope - lowSlope) / (Math.abs(highSlope) + Math.abs(lowSlope) || 1);

  if (slopeDiff > 0.2) return null;

  const direction = highSlope > 0 ? 'bullish' : highSlope < 0 ? 'bearish' : 'neutral';

  if (direction === 'neutral') return null;

  return {
    name: direction === 'bullish' ? 'Ascending Channel' : 'Descending Channel',
    direction: direction === 'bullish' ? 'bullish' : 'bearish',
    startIndex: candles.length - lookback,
    endIndex: candles.length - 1,
    confidence: 0.5,
    keyLevels: [
      { label: 'Channel Top', price: highs[highs.length - 1].price, index: highs[highs.length - 1].index, time: highs[highs.length - 1].time },
      { label: 'Channel Bottom', price: lows[lows.length - 1].price, index: lows[lows.length - 1].index, time: lows[lows.length - 1].time },
    ],
    description: direction === 'bullish'
      ? 'Price moving between two parallel upward-sloping lines. The upper line acts as resistance, the lower as support.'
      : 'Price moving between two parallel downward-sloping lines. The upper line acts as resistance, the lower as support.',
    confirmed: false,
  };
}


// ── Enrichment: invalidation, confirmation, context ─────────────
// Every pattern must state what invalidates it, what confirmed it (or what is
// still needed) and whether it trades WITH or AGAINST the prevailing structure.
// A pattern on its own never produces a trade — the decision engine requires
// independent confirmation.

export function enrichChartPatterns(
  patterns: ChartPattern[],
  candles: Candle[],
  prevailing: 'bullish' | 'bearish' | 'neutral',
): ChartPattern[] {
  return patterns.map(p => {
    const lo = Math.max(0, p.startIndex);
    const hi = Math.min(candles.length - 1, p.endIndex);
    const seg = candles.slice(lo, hi + 1);
    let invalidation: number | undefined;
    if (seg.length) {
      invalidation = p.direction === 'bullish' ? Math.min(...seg.map(c => c.low))
        : p.direction === 'bearish' ? Math.max(...seg.map(c => c.high)) : undefined;
    }
    const context: ChartPattern['context'] =
      p.direction === 'neutral' || prevailing === 'neutral' ? 'neutral'
        : p.direction === prevailing ? 'with-trend' : 'counter-trend';
    const confirmation = p.confirmed
      ? 'Confirmed: price has closed beyond the pattern trigger level'
      : 'Not confirmed: still needs a candle CLOSE beyond the trigger level (neckline / breakout line)';
    return { ...p, invalidation, confirmation, context };
  });
}
