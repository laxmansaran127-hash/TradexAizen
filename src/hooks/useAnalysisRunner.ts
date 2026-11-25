import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetConfig, Candle, Timeframe } from '@/types/trading';
import type { AnalysisResult } from '@/lib/analysis/types';
import type { NewsState } from '@/types/news';
import type { CalendarState } from '@/hooks/useEconomicCalendar';
import { runAnalysis } from '@/lib/analysis/engine';
import { loadContextCandles } from '@/lib/data/context';
import { assessNewsRisk, relevantCurrencies } from '@/lib/news/risk';
import { FX_INSTRUMENTS, type FxInstrumentId } from '@/lib/data/fxProviders';
import type { Freshness } from '@/lib/data/validation';

interface RunnerArgs {
  config: AssetConfig;
  timeframe: Timeframe;
  candles: Candle[];
  loading: boolean;
  freshness: Freshness;
  /** Candles opened before this are partial (tick-built) and excluded. */
  floorTime?: number | null;
  news: NewsState;
  calendar: CalendarState;
}

/**
 * One implementation of "press Analyze" for every asset widget.
 * - fetches real higher/middle timeframe candles (cached) for MTF context;
 * - turns the news + calendar state into an explicit risk assessment;
 * - discards results if the asset/timeframe changed while it was running;
 * - never runs while data is loading.
 */
export function useAnalysisRunner(a: RunnerArgs) {
  const { config, timeframe } = a;
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const runId = useRef(0);
  const ctlRef = useRef<AbortController | null>(null);
  const latest = useRef(a);
  latest.current = a;

  // A result belongs to one asset+timeframe: drop it (and cancel work) when either changes.
  useEffect(() => {
    runId.current++;
    ctlRef.current?.abort();
    setAnalysis(null);
    setAnalyzing(false);
    return () => { runId.current++; ctlRef.current?.abort(); };
  }, [config.id, timeframe]);

  const usable = a.candles.filter(c => !a.floorTime || c.time >= a.floorTime).length;
  const canAnalyze = !a.loading && usable >= 50 && !analyzing;
  const blockedReason = a.loading ? 'Loading market data…' : usable < 50 ? `Need 50 candles of real data (have ${usable})` : null;

  const handleAnalyze = useCallback(async () => {
    const cur = latest.current;
    const id = ++runId.current;
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setAnalyzing(true);
    try {
      const ctxCandles = await loadContextCandles(cur.config, cur.timeframe, ctl.signal);
      if (id !== runId.current) return;

      const now = Date.now();
      const newsOk = !!cur.news.lastUpdated && !cur.news.error;
      const risk = assessNewsRisk({
        events: cur.calendar.events,
        headlines: newsOk ? cur.news.items : null,
        currencies: relevantCurrencies(cur.config.id),
        now,
      });

      const kind = cur.config.category === 'Crypto' ? 'crypto' : cur.config.category === 'Forex' ? 'fx' : 'metal';
      const maxJump = kind === 'crypto' ? 0.5 : FX_INSTRUMENTS[cur.config.id as FxInstrumentId]?.maxJump ?? 0.08;
      const result = runAnalysis(cur.candles, cur.config.displaySymbol, cur.timeframe, {
        decimals: cur.config.decimals, kind, maxJump,
        feed: cur.freshness === 'none' ? 'none' : cur.freshness,
        news: risk, floorTime: cur.floorTime ?? null, nowSec: Math.floor(now / 1000),
        contextCandles: { middle: ctxCandles.middle, higher: ctxCandles.higher },
      });
      if (id !== runId.current) return;
      if (result && !ctxCandles.higher && ctxCandles.higherTf) result.dataNotes = [...(result.dataNotes ?? []), `${ctxCandles.higherTf} context could not be loaded`];
      setAnalysis(result);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') console.error('[analysis]', e);
    } finally {
      if (id === runId.current) setAnalyzing(false);
    }
  }, []);

  // Has a newer closed candle formed since this analysis was produced?
  const stepSec = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600, '4H': 14400, '1D': 86400 }[timeframe];
  const lastCandle = a.candles[a.candles.length - 1];
  const analysisStale = !!analysis?.asOf && !!lastCandle && lastCandle.time - analysis.asOf >= stepSec;

  return { analysis, setAnalysis, analyzing, handleAnalyze, canAnalyze, blockedReason, analysisStale };
}
