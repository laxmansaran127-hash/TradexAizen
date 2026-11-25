import type { Candle, AssetConfig, Timeframe } from '@/types/trading';
import { TF_SECONDS } from '@/types/trading';
import { fetchBinanceKlines } from './binance';
import { FX_INSTRUMENTS, loadFxHistory, type FxInstrumentId } from './fxProviders';
import { getContextTimeframes } from '@/lib/analysis/mtf';

// ── Context-timeframe candles for multi-timeframe analysis ──────
// Each timeframe is fetched on its own and never merged with another.
// Short-lived cache keeps repeated "Analyze" clicks from hammering free API tiers.

const cache = new Map<string, { at: number; candles: Candle[] }>();
const MAX_CACHE = 40;

async function fetchOne(asset: AssetConfig, tf: Timeframe, signal?: AbortSignal): Promise<Candle[] | null> {
  const key = `${asset.id}:${tf}`;
  const ttl = Math.min((TF_SECONDS[tf] * 1000) / 2, 5 * 60_000);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.candles;
  try {
    let candles: Candle[];
    if (asset.category === 'Crypto') {
      candles = await fetchBinanceKlines(asset.symbol, tf, 300, signal);
    } else {
      candles = (await loadFxHistory(FX_INSTRUMENTS[asset.id as FxInstrumentId], tf, signal)).candles;
    }
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), candles });
    return candles;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    return null; // context unavailable — reported as such, never substituted
  }
}

export interface ContextLoad {
  middle: Candle[] | null;
  higher: Candle[] | null;
  middleTf: Timeframe | null;
  higherTf: Timeframe | null;
}

export async function loadContextCandles(asset: AssetConfig, tf: Timeframe, signal?: AbortSignal): Promise<ContextLoad> {
  const { middle, higher } = getContextTimeframes(tf);
  const [m, h] = await Promise.all([
    middle ? fetchOne(asset, middle, signal) : Promise.resolve(null),
    higher ? fetchOne(asset, higher, signal) : Promise.resolve(null),
  ]);
  return { middle: m, higher: h, middleTf: middle, higherTf: higher };
}
