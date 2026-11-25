import type { Candle, Timeframe } from '@/types/trading';
import { BINANCE_INTERVAL_MAP } from '@/types/trading';
import { fetchJson } from './http';

// ── Binance market-data endpoints ───────────────────────────────
// `data-*.binance.vision` is Binance's public market-data-only mirror and is
// reachable from regions where api.binance.com answers HTTP 451. The primary
// hosts remain as fallback. Same data, same schema.

export const BINANCE_REST_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
export const BINANCE_WS_HOSTS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'];

export function klinesUrls(symbol: string, tf: Timeframe, limit: number): string[] {
  const q = `symbol=${encodeURIComponent(symbol)}&interval=${BINANCE_INTERVAL_MAP[tf]}&limit=${limit}`;
  return BINANCE_REST_HOSTS.map(h => `${h}/api/v3/klines?${q}`);
}

/** Documented combined-stream endpoint: messages arrive as {stream, data}. */
export function combinedStreamUrls(symbol: string, tf: Timeframe, extra: string[] = []): string[] {
  const s = symbol.toLowerCase();
  const streams = [`${s}@kline_${BINANCE_INTERVAL_MAP[tf]}`, `${s}@ticker`, ...extra].join('/');
  return BINANCE_WS_HOSTS.map(h => `${h}/stream?streams=${streams}`);
}

export function aggTradeStreamUrls(symbol: string): string[] {
  return BINANCE_WS_HOSTS.map(h => `${h}/ws/${symbol.toLowerCase()}@aggTrade`);
}

export async function fetchBinanceKlines(symbol: string, tf: Timeframe, limit: number, signal?: AbortSignal): Promise<Candle[]> {
  const data = await fetchJson(klinesUrls(symbol, tf, limit), { signal, timeoutMs: 10_000, retries: 1 });
  if (!Array.isArray(data)) throw new Error('Unexpected klines response');
  return (data as (string | number)[][]).map(k => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

export interface ParsedKline { candle: Candle; closed: boolean; symbol: string; interval: string }
export interface ParsedTicker { price: number; open: number; high: number; low: number; volume: number; change: number; changePercent: number; eventMs: number; symbol: string }

/** Returns the kline / ticker payload from a raw WS frame (combined or raw). */
export function parseBinanceFrame(raw: string): { kline?: ParsedKline; ticker?: ParsedTicker } {
  const msg = JSON.parse(raw) as Record<string, unknown>;
  const d = (msg.data && typeof msg.data === 'object' ? msg.data : msg) as Record<string, unknown>;

  if (d.e === 'kline' && d.k && typeof d.k === 'object') {
    const k = d.k as Record<string, string | number | boolean>;
    return {
      kline: {
        candle: {
          time: Math.floor(Number(k.t) / 1000),
          open: parseFloat(String(k.o)),
          high: parseFloat(String(k.h)),
          low: parseFloat(String(k.l)),
          close: parseFloat(String(k.c)),
          volume: parseFloat(String(k.v)),
        },
        closed: k.x === true,
        symbol: String(d.s ?? '').toUpperCase(),
        interval: String(k.i ?? ''),
      },
    };
  }
  if (d.e === '24hrTicker') {
    return {
      ticker: {
        price: parseFloat(String(d.c)),
        open: parseFloat(String(d.o)),
        high: parseFloat(String(d.h)),
        low: parseFloat(String(d.l)),
        volume: parseFloat(String(d.v)),
        change: parseFloat(String(d.p)),
        changePercent: parseFloat(String(d.P)),
        eventMs: Number(d.E) || Date.now(),
        symbol: String(d.s ?? '').toUpperCase(),
      },
    };
  }
  return {};
}

/** Replace the candle with the same open time, or append if newer. Older bars are ignored. */
export function mergeCandle(list: Candle[], c: Candle): Candle[] {
  if (list.length === 0) return [c];
  const last = list[list.length - 1];
  if (c.time === last.time) return [...list.slice(0, -1), c];
  if (c.time > last.time) return [...list, c];
  // late/out-of-order bar: replace in place if it exists, otherwise ignore
  const i = list.findIndex(x => x.time === c.time);
  if (i === -1) return list;
  const copy = list.slice();
  copy[i] = c;
  return copy;
}

export function mergeCandleLists(base: Candle[], incoming: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of base) map.set(c.time, c);
  for (const c of incoming) map.set(c.time, c);
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}
