import type { Asset, Candle, Timeframe } from '@/types/trading';
import { ASSET_CONFIGS } from '@/types/trading';
import { fetchBinanceKlines } from '@/lib/data/binance';
import { FX_INSTRUMENTS, loadFxHistory, type FxInstrumentId } from '@/lib/data/fxProviders';
import { loadContextCandles } from '@/lib/data/context';
import { assessNewsRisk, relevantCurrencies, type CalendarEvent } from '@/lib/news/risk';
import type { AgentDeps } from './agent';

// Real data sources only (the project's existing providers). Failures THROW — the agent turns that
// into "market data unavailable" and refuses to trade; nothing is substituted or simulated.

export function createLiveDeps(getCalendar: () => CalendarEvent[] | null): AgentDeps {
  return {
    async loadBars(assetId: Asset, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
      const cfg = ASSET_CONFIGS.find(a => a.id === assetId);
      if (!cfg) throw new Error(`unknown asset ${assetId}`);
      if (cfg.category === 'Crypto') return fetchBinanceKlines(cfg.symbol, tf, 300, signal);
      return (await loadFxHistory(FX_INSTRUMENTS[assetId as FxInstrumentId], tf, signal)).candles;
    },
    async loadContext(assetId, tf, signal) {
      const cfg = ASSET_CONFIGS.find(a => a.id === assetId)!;
      const c = await loadContextCandles(cfg, tf, signal);
      return { middle: c.middle, higher: c.higher, higherTf: c.higherTf };
    },
    newsFor(assetId, nowMs) {
      return assessNewsRisk({ events: getCalendar(), headlines: null, currencies: relevantCurrencies(assetId), now: nowMs });
    },
  };
}
