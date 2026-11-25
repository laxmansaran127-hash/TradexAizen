import type { Candle, Timeframe } from '@/types/trading';
import { TF_SECONDS } from '@/types/trading';
import { fetchJson, HttpError } from './http';

// ── Real forex / gold data providers ────────────────────────────
// Spot FX and XAU/USD are NOT available from Binance. Previously the app
// scaled unrelated Binance pairs (EURUSDT / EURGBP / BTCJPY) by a daily FX rate
// to imitate these markets — that was synthetic data and has been removed.
//
// Sources (no synthetic fallback — if none works, the UI says so):
//   live ticks  : Finnhub WebSocket, OANDA instruments
//   history     : Twelve Data (if VITE_TWELVEDATA_API_KEY set) → Finnhub /forex/candle
//                 (Finnhub's candle endpoint is plan-restricted; a 403 is reported honestly)

export type FxInstrumentId = 'EURUSD' | 'GBPUSD' | 'USDJPY' | 'GOLD';

export interface FxInstrument {
  id: FxInstrumentId;
  finnhubSymbol: string;
  twelveSymbol: string;
  displaySymbol: string;
  decimals: number;
  kind: 'fx' | 'metal';
  /** Largest plausible close-to-close move (fraction) used by data validation. */
  maxJump: number;
}

export const FX_INSTRUMENTS: Record<FxInstrumentId, FxInstrument> = {
  EURUSD: { id: 'EURUSD', finnhubSymbol: 'OANDA:EUR_USD', twelveSymbol: 'EUR/USD', displaySymbol: 'EUR/USD', decimals: 5, kind: 'fx', maxJump: 0.05 },
  GBPUSD: { id: 'GBPUSD', finnhubSymbol: 'OANDA:GBP_USD', twelveSymbol: 'GBP/USD', displaySymbol: 'GBP/USD', decimals: 5, kind: 'fx', maxJump: 0.05 },
  USDJPY: { id: 'USDJPY', finnhubSymbol: 'OANDA:USD_JPY', twelveSymbol: 'USD/JPY', displaySymbol: 'USD/JPY', decimals: 3, kind: 'fx', maxJump: 0.05 },
  GOLD:   { id: 'GOLD',   finnhubSymbol: 'OANDA:XAU_USD', twelveSymbol: 'XAU/USD', displaySymbol: 'XAU/USD', decimals: 2, kind: 'metal', maxJump: 0.08 },
};

export const FINNHUB_RESOLUTION: Record<Timeframe, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1H': '60', '4H': '240', '1D': 'D',
};
const TWELVE_INTERVAL: Record<Timeframe, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1H': '1h', '4H': '4h', '1D': '1day',
};

// Vite injects import.meta.env in the browser; the Node verification script uses process.env.
const ENV: Record<string, string | undefined> =
  (import.meta.env as Record<string, string | undefined> | undefined) ??
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const FINNHUB_KEY = ENV.VITE_FINNHUB_API_KEY ?? '';
const TWELVE_KEY = ENV.VITE_TWELVEDATA_API_KEY ?? '';

export const hasFinnhubKey = (): boolean => FINNHUB_KEY.length > 0;
export const finnhubWsUrl = (): string => `wss://ws.finnhub.io?token=${FINNHUB_KEY}`;

export type HistorySource = 'twelvedata' | 'finnhub';
export interface HistoryResult { candles: Candle[]; source: HistorySource }

export class HistoryUnavailableError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Historical candles unavailable: ${reasons.join('; ')}`);
    this.name = 'HistoryUnavailableError';
  }
}

// ── History loaders ─────────────────────────────────────────────

export function parseTwelveDatetime(s: string): number {
  // "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD", requested with timezone=UTC
  const iso = s.length <= 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`;
  return Math.floor(Date.parse(iso) / 1000);
}

export function parseTwelveResponse(data: unknown): Candle[] {
  const d = data as { status?: string; message?: string; values?: Record<string, string>[] };
  if (d?.status === 'error' || !Array.isArray(d?.values)) {
    throw new Error(d?.message ? `Twelve Data: ${d.message}` : 'Twelve Data: malformed response');
  }
  return d.values.map(v => {
    const c: Candle = {
      time: parseTwelveDatetime(v.datetime),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    };
    // Spot FX carries no real volume — leave it undefined rather than inventing 0s.
    if (v.volume !== undefined && parseFloat(v.volume) > 0) c.volume = parseFloat(v.volume);
    return c;
  });
}

async function loadTwelve(inst: FxInstrument, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  if (!TWELVE_KEY) throw new Error('Twelve Data key not configured');
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(inst.twelveSymbol)}&interval=${TWELVE_INTERVAL[tf]}&outputsize=500&order=ASC&timezone=UTC&apikey=${TWELVE_KEY}`;
  return parseTwelveResponse(await fetchJson(url, { signal, retries: 1 }));
}

async function loadFinnhub(inst: FxInstrument, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  if (!FINNHUB_KEY) throw new Error('Finnhub key not configured');
  const now = Math.floor(Date.now() / 1000);
  const from = now - TF_SECONDS[tf] * 500;
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(inst.finnhubSymbol)}&resolution=${FINNHUB_RESOLUTION[tf]}&from=${from}&to=${now}&token=${FINNHUB_KEY}`;
  let data: { s?: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] };
  try {
    data = (await fetchJson(url, { signal, retries: 0 })) as typeof data;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      throw new Error('Finnhub candle history is not included in this API plan');
    }
    throw e;
  }
  if (data.s !== 'ok' || !data.t || data.t.length === 0) throw new Error('Finnhub returned no candles');
  return data.t.map((t, i) => {
    const c: Candle = { time: t, open: data.o![i], high: data.h![i], low: data.l![i], close: data.c![i] };
    if (data.v && data.v[i] > 0) c.volume = data.v[i];
    return c;
  });
}

/** Try each real source in order. Throws HistoryUnavailableError — never fabricates. */
export async function loadFxHistory(inst: FxInstrument, tf: Timeframe, signal?: AbortSignal): Promise<HistoryResult> {
  const reasons: string[] = [];
  const attempts: [HistorySource, () => Promise<Candle[]>][] = [
    ['twelvedata', () => loadTwelve(inst, tf, signal)],
    ['finnhub', () => loadFinnhub(inst, tf, signal)],
  ];
  for (const [source, fn] of attempts) {
    try {
      const candles = await fn();
      if (candles.length > 0) return { candles, source };
      reasons.push(`${source}: empty`);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      reasons.push(`${source}: ${(e as Error).message}`);
    }
  }
  throw new HistoryUnavailableError(reasons);
}

// ── Tick → candle aggregation (pure) ────────────────────────────

export interface Tick { price: number; timeSec: number; volume?: number }

export interface ApplyTickResult {
  candles: Candle[];
  live: Candle;
  /** true if the tick opened a new bar */
  newBar: boolean;
}

/**
 * Fold a real trade tick into the candle series.
 * - Bars are anchored to the provider's own bar boundaries (the last candle's
 *   open time), so daily bars that open at 22:00 UTC are not mis-aligned.
 * - Ticks older than the last bar are ignored (late/out-of-order).
 * - Quiet periods produce NO filler bars: a bar only exists if ticks occurred.
 */
export function applyTick(candles: Candle[], tick: Tick, tf: Timeframe): ApplyTickResult | null {
  if (!Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.timeSec)) return null;
  const tfSec = TF_SECONDS[tf];
  const vol = tick.volume && tick.volume > 0 ? tick.volume : 0;

  if (candles.length === 0) {
    const t = Math.floor(tick.timeSec / tfSec) * tfSec;
    const live: Candle = { time: t, open: tick.price, high: tick.price, low: tick.price, close: tick.price };
    if (vol) live.volume = vol;
    return { candles: [live], live, newBar: true };
  }

  const last = candles[candles.length - 1];
  if (tick.timeSec < last.time) return null;

  if (tick.timeSec < last.time + tfSec) {
    const merged: Candle = {
      ...last,
      high: Math.max(last.high, tick.price),
      low: Math.min(last.low, tick.price),
      close: tick.price,
    };
    if (vol) merged.volume = (last.volume ?? 0) + vol;
    return { candles: [...candles.slice(0, -1), merged], live: merged, newBar: false };
  }

  const barTime = last.time + Math.floor((tick.timeSec - last.time) / tfSec) * tfSec;
  const live: Candle = { time: barTime, open: tick.price, high: tick.price, low: tick.price, close: tick.price };
  if (vol) live.volume = vol;
  return { candles: [...candles, live], live, newBar: true };
}

// ── 24h stats from real candles ─────────────────────────────────

export interface DayStats { open: number; high: number; low: number }

/** Returns null unless the loaded candles really cover the last 24 hours. */
export function compute24hStats(candles: Candle[], tf: Timeframe, nowSec: number): DayStats | null {
  const cutoff = nowSec - 86400;
  const tfSec = TF_SECONDS[tf];
  const window = candles.filter(c => c.time >= cutoff - tfSec);
  if (window.length === 0 || candles.length === 0) return null;
  if (candles[0].time > cutoff + tfSec) return null; // history doesn't reach back 24h
  let high = -Infinity, low = Infinity;
  for (const c of window) { high = Math.max(high, c.high); low = Math.min(low, c.low); }
  return { open: window[0].open, high, low };
}
