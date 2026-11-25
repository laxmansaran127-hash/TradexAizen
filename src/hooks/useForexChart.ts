import type { Timeframe } from '@/types/trading';
import { FX_INSTRUMENTS, type FxInstrument } from '@/lib/data/fxProviders';
import { useFinnhubChart } from '@/hooks/useFinnhubChart';

/**
 * Spot forex (EUR/USD, GBP/USD, USD/JPY) — REAL quotes only.
 *
 * The previous implementation derived these charts from unrelated Binance pairs
 * (EURUSDT / EURGBP / BTCJPY) scaled by a daily FX rate. That produced synthetic
 * candles and has been removed. This now shares the hardened Finnhub/Twelve Data
 * pipeline used for gold.
 */
export type ForexConfig = FxInstrument;

export function getForexInstrument(assetId: string): FxInstrument | null {
  return assetId === 'EURUSD' || assetId === 'GBPUSD' || assetId === 'USDJPY' ? FX_INSTRUMENTS[assetId] : null;
}

export function useForexChart(config: ForexConfig, timeframe: Timeframe) {
  return useFinnhubChart(timeframe, config);
}
