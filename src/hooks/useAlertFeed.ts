import { useEffect } from 'react';
import type { TickerData } from '@/types/trading';
import type { Freshness } from '@/lib/data/validation';
import { alertEngine } from '@/lib/alertEngine';

/**
 * Feeds the live price of the asset being viewed into the alert engine.
 * (Previously nothing ever called alertEngine.evaluate(), so alerts could never fire.)
 * Only fresh, finite prices are evaluated. Alerts are evaluated for the symbol that has
 * a live feed open — there is intentionally no hidden background polling.
 */
export function useAlertFeed(displaySymbol: string, ticker: TickerData | null, freshness: Freshness) {
  useEffect(() => {
    if (!ticker || freshness !== 'fresh' || !Number.isFinite(ticker.price) || ticker.price <= 0) return;
    const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
    alertEngine.evaluate({
      symbol: displaySymbol,
      price: ticker.price,
      change: num(ticker.change, 0),
      changePercent: num(ticker.changePercent, 0),
      high: num(ticker.high, ticker.price),
      low: num(ticker.low, ticker.price),
      open: num(ticker.open, ticker.price),
      close: ticker.price,
      volume: ticker.volume ?? 0,
      marketStatus: 'open',
      lastUpdate: ticker.timestamp,
    });
  }, [displaySymbol, ticker, freshness]);
}
