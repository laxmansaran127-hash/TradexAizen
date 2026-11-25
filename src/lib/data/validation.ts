import type { Candle, Timeframe } from '@/types/trading';
import { TF_SECONDS } from '@/types/trading';

// ── Market-data validation ──────────────────────────────────────
// Every candle that reaches the chart or the analysis engine passes through
// here. Invalid data is REJECTED (dropped + reported), never "repaired" with
// guessed values.

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code:
    | 'NON_FINITE'
    | 'NON_POSITIVE_PRICE'
    | 'INVALID_OHLC'
    | 'NEGATIVE_VOLUME'
    | 'BAD_TIMESTAMP'
    | 'DUPLICATE'
    | 'OUT_OF_ORDER'
    | 'MISALIGNED'
    | 'GAP'
    | 'PRICE_JUMP';
  severity: IssueSeverity;
  time?: number;
  detail: string;
}

export interface SanitizeOptions {
  /** Timeframe the series is supposed to be on (enables alignment/gap checks). */
  timeframe?: Timeframe;
  /** True for 24/7 markets (crypto). Gaps are then real data holes. */
  continuous?: boolean;
  /** Largest plausible close-to-close move as a fraction (0.35 = 35%). */
  maxJump?: number;
  /** Clock override for tests. */
  nowSec?: number;
}

export interface SanitizeResult {
  candles: Candle[];
  issues: ValidationIssue[];
  dropped: number;
  /** Missing candles inside the series (only meaningful for continuous markets). */
  missingCandles: number;
  /** Missing candles within the most recent 60 bars (continuous markets). */
  missingRecent: number;
}

const MIN_PLAUSIBLE_TIME = 1230768000; // 2009-01-01 — before any supported market data

export function validateCandle(c: Candle): ValidationIssue | null {
  const vals = [c.time, c.open, c.high, c.low, c.close];
  if (vals.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
    return { code: 'NON_FINITE', severity: 'error', time: c.time, detail: 'Candle contains a non-numeric value' };
  }
  if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
    return { code: 'NON_POSITIVE_PRICE', severity: 'error', time: c.time, detail: 'Price is zero or negative' };
  }
  if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close) {
    return { code: 'INVALID_OHLC', severity: 'error', time: c.time, detail: 'High/Low do not contain Open/Close' };
  }
  if (c.volume !== undefined && (!Number.isFinite(c.volume) || c.volume < 0)) {
    return { code: 'NEGATIVE_VOLUME', severity: 'error', time: c.time, detail: 'Volume is negative or non-numeric' };
  }
  if (!Number.isInteger(c.time) || c.time < MIN_PLAUSIBLE_TIME) {
    return { code: 'BAD_TIMESTAMP', severity: 'error', time: c.time, detail: 'Timestamp is not a plausible unix-seconds integer' };
  }
  return null;
}

export function sanitizeCandles(raw: Candle[], opts: SanitizeOptions = {}): SanitizeResult {
  const issues: ValidationIssue[] = [];
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const tfSec = opts.timeframe ? TF_SECONDS[opts.timeframe] : undefined;
  const maxJump = opts.maxJump ?? 0.35;

  // 1. Per-candle validity
  const valid: Candle[] = [];
  for (const c of raw) {
    const issue = validateCandle(c);
    if (issue) { issues.push(issue); continue; }
    if (c.time > nowSec + (tfSec ?? 86400) * 2) {
      issues.push({ code: 'BAD_TIMESTAMP', severity: 'error', time: c.time, detail: 'Candle timestamp is in the future' });
      continue;
    }
    valid.push(c);
  }

  // 2. Ordering + de-duplication (later duplicate wins: it is the fresher update)
  let sorted = true;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].time < valid[i - 1].time) { sorted = false; break; }
  }
  if (!sorted) {
    issues.push({ code: 'OUT_OF_ORDER', severity: 'warning', detail: 'Candles arrived out of order and were re-sorted' });
    valid.sort((a, b) => a.time - b.time);
  }
  const deduped: Candle[] = [];
  for (const c of valid) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === c.time) {
      issues.push({ code: 'DUPLICATE', severity: 'warning', time: c.time, detail: 'Duplicate candle timestamp' });
      deduped[deduped.length - 1] = c;
    } else {
      deduped.push(c);
    }
  }

  // 3. Alignment, gaps and implausible jumps
  let missingCandles = 0;
  let missingRecent = 0;
  const n = deduped.length;
  for (let i = 0; i < n; i++) {
    const c = deduped[i];
    if (tfSec && tfSec < 86400 && c.time % tfSec !== 0) {
      issues.push({ code: 'MISALIGNED', severity: 'warning', time: c.time, detail: 'Candle open time is not aligned to the timeframe' });
    }
    if (i > 0) {
      const prev = deduped[i - 1];
      if (tfSec && opts.continuous) {
        const missing = Math.round((c.time - prev.time) / tfSec) - 1;
        if (missing > 0) {
          missingCandles += missing;
          if (i >= n - 60) missingRecent += missing;
          issues.push({ code: 'GAP', severity: 'warning', time: c.time, detail: `${missing} candle(s) missing before this bar` });
        }
      }
      const jump = Math.abs(c.close / prev.close - 1);
      if (jump > maxJump) {
        issues.push({ code: 'PRICE_JUMP', severity: 'warning', time: c.time, detail: `Close-to-close move of ${(jump * 100).toFixed(1)}% is implausibly large` });
      }
    }
  }

  return {
    candles: deduped,
    issues,
    dropped: raw.length - deduped.length,
    missingCandles,
    missingRecent,
  };
}

// ── Closed-candle handling ──────────────────────────────────────

/** A candle is closed once its whole period has elapsed. */
export function isCandleClosed(c: Candle, timeframe: Timeframe, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return c.time + TF_SECONDS[timeframe] <= nowSec;
}

/** Remove the still-forming trailing candle so analysis only ever sees completed bars. */
export function dropFormingCandle(candles: Candle[], timeframe: Timeframe, nowSec = Math.floor(Date.now() / 1000)): Candle[] {
  if (candles.length === 0) return candles;
  return isCandleClosed(candles[candles.length - 1], timeframe, nowSec) ? candles : candles.slice(0, -1);
}

// ── Freshness ───────────────────────────────────────────────────

export type Freshness = 'fresh' | 'stale' | 'dead' | 'none';

export interface FreshnessThresholds {
  staleAfterMs: number;
  deadAfterMs: number;
}

export const CRYPTO_FRESHNESS: FreshnessThresholds = { staleAfterMs: 15_000, deadAfterMs: 60_000 };
// FX/metal tick feeds can be legitimately quiet for a while between quotes.
export const FX_FRESHNESS: FreshnessThresholds = { staleAfterMs: 60_000, deadAfterMs: 5 * 60_000 };

export function assessFreshness(lastUpdateMs: number | null, nowMs: number, t: FreshnessThresholds): Freshness {
  if (lastUpdateMs === null) return 'none';
  const age = nowMs - lastUpdateMs;
  if (age >= t.deadAfterMs) return 'dead';
  if (age >= t.staleAfterMs) return 'stale';
  return 'fresh';
}

/**
 * Calendar fact, not market data: the spot FX / gold weekend closure
 * (approximately Fri 21:00 UTC → Sun 22:00 UTC). Only ever used to LABEL an
 * already-stale feed as "market closed" — never to suppress a stale warning
 * while ticks are still flowing.
 */
export function isFxWeekendWindow(d: Date): boolean {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return true;
  if (day === 5 && h >= 21) return true;
  if (day === 0 && h < 22) return true;
  return false;
}

export type DataHealthLevel = 'ok' | 'degraded' | 'unusable';

export interface DataHealth {
  level: DataHealthLevel;
  reasons: string[];
}

/** Gate used by the analysis engine: can this series be analysed at all? */
export function assessSeriesHealth(result: SanitizeResult, opts: { minCandles: number; continuous: boolean }): DataHealth {
  const reasons: string[] = [];
  const errors = result.issues.filter(i => i.severity === 'error').length;
  if (result.candles.length < opts.minCandles) {
    reasons.push(`Only ${result.candles.length} valid candles (need ${opts.minCandles})`);
    return { level: 'unusable', reasons };
  }
  if (result.dropped > 0 && result.dropped / (result.dropped + result.candles.length) > 0.05) {
    reasons.push(`${result.dropped} invalid candles rejected (>5% of the series)`);
    return { level: 'unusable', reasons };
  }
  if (opts.continuous && result.missingRecent > 3) {
    reasons.push(`${result.missingRecent} candles missing in the most recent 60 bars`);
    return { level: 'unusable', reasons };
  }
  if (errors > 0) reasons.push(`${errors} invalid candle(s) were rejected`);
  if (result.issues.some(i => i.code === 'PRICE_JUMP')) reasons.push('Implausible price jump(s) present in series');
  if (result.issues.some(i => i.code === 'GAP')) reasons.push('Some candles are missing from the series');
  return { level: reasons.length ? 'degraded' : 'ok', reasons };
}
