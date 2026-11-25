import { useState, useEffect, useRef, useCallback } from 'react';
import type { Candle, TickerData, Timeframe, ConnectionState } from '@/types/trading';
import { TF_SECONDS } from '@/types/trading';
import { ManagedSocket } from '@/lib/data/managedSocket';
import {
  applyTick,
  compute24hStats,
  FX_INSTRUMENTS,
  finnhubWsUrl,
  hasFinnhubKey,
  HistoryUnavailableError,
  loadFxHistory,
  type DayStats,
  type FxInstrument,
  type HistorySource,
} from '@/lib/data/fxProviders';
import {
  assessFreshness,
  assessSeriesHealth,
  FX_FRESHNESS,
  isFxWeekendWindow,
  sanitizeCandles,
  type DataHealth,
  type Freshness,
} from '@/lib/data/validation';

interface FinnhubTrade { s: string; p: number; t: number; v?: number }

/** Merge a tick-built live bar into freshly loaded provider history without discarding
 *  the provider's real open/high/low for the same bar. */
function combineLive(history: Candle[], live: Candle | null): Candle[] {
  if (!live || history.length === 0) return history;
  const last = history[history.length - 1];
  if (live.time === last.time) {
    const merged: Candle = { ...last, high: Math.max(last.high, live.high), low: Math.min(last.low, live.low), close: live.close };
    return [...history.slice(0, -1), merged];
  }
  if (live.time > last.time) return [...history, live];
  return history;
}

/**
 * Real-time spot FX / gold feed (Finnhub live ticks + real historical candles).
 * Default instrument is gold so existing callers `useFinnhubChart(timeframe)` keep working.
 *
 * If no real history source is reachable the hook does NOT invent candles: it
 * reports `historyUnavailable` and builds bars purely from live ticks, flagging
 * the first (partial) bar via `analysisFloorTime` so analysis never uses it.
 */
export function useFinnhubChart(timeframe: Timeframe, instrument: FxInstrument = FX_INSTRUMENTS.GOLD) {
  const inst = instrument;

  const [candles, setCandles] = useState<Candle[]>([]);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Freshness>('none');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [marketClosed, setMarketClosed] = useState(false);
  const [dataHealth, setDataHealth] = useState<DataHealth>({ level: 'ok', reasons: [] });
  const [historySource, setHistorySource] = useState<HistorySource | null>(null);
  const [analysisFloorTime, setAnalysisFloorTime] = useState<number | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const candlesRef = useRef<Candle[]>([]);
  const historyStateRef = useRef<'loading' | 'ok' | 'unavailable'>('loading');
  const statsRef = useRef<DayStats | null>(null);
  const lastDataRef = useRef<number | null>(null);
  const lastPriceRef = useRef<number | null>(null);
  const lastTickSecRef = useRef<number | null>(null);
  const tfRef = useRef<Timeframe>(timeframe);
  useEffect(() => { tfRef.current = timeframe; }, [timeframe]);

  const commit = useCallback((next: Candle[]) => {
    candlesRef.current = next;
    setCandles(next);
  }, []);

  // Reset everything tied to the instrument.
  useEffect(() => {
    setTicker(null);
    setLastUpdate(null);
    setFreshness('none');
    setMarketClosed(false);
    lastDataRef.current = null;
    lastPriceRef.current = null;
    lastTickSecRef.current = null;
  }, [inst.id]);

  // ── Real history ───────────────────────────────────────────────
  useEffect(() => {
    const ctl = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);
    setNotice(null);
    setHistorySource(null);
    setAnalysisFloorTime(null);
    historyStateRef.current = 'loading';
    statsRef.current = null;
    commit([]);
    setLiveCandle(null);

    if (!hasFinnhubKey()) {
      setError('Finnhub API key not configured — live FX/gold data unavailable');
      setConnectionState('disconnected');
      setLoading(false);
      historyStateRef.current = 'unavailable';
      return () => { cancelled = true; ctl.abort(); };
    }

    (async () => {
      try {
        const { candles: raw, source } = await loadFxHistory(inst, timeframe, ctl.signal);
        if (cancelled) return;
        const result = sanitizeCandles(raw, { timeframe, continuous: false, maxJump: inst.maxJump });
        if (result.candles.length === 0) throw new HistoryUnavailableError(['provider returned only invalid candles']);

        const merged = combineLive(result.candles, candlesRef.current[candlesRef.current.length - 1] ?? null);
        commit(merged);
        setLiveCandle(merged[merged.length - 1]);
        setHistorySource(source);
        setDataHealth(assessSeriesHealth(result, { minCandles: 30, continuous: false }));
        statsRef.current = compute24hStats(merged, timeframe, Math.floor(Date.now() / 1000));
        historyStateRef.current = 'ok';
        setLoading(false);
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        historyStateRef.current = 'unavailable';
        setNotice(
          err instanceof HistoryUnavailableError
            ? `HISTORICAL DATA UNAVAILABLE — candles are built only from live ticks received since this page opened (${err.reasons.join('; ')}).`
            : `HISTORICAL DATA UNAVAILABLE — ${(err as Error).message}`,
        );
        setLoading(false);
      }
    })();

    return () => { cancelled = true; ctl.abort(); };
  }, [inst, timeframe, reloadNonce, commit]);

  // ── Live ticks ─────────────────────────────────────────────────
  useEffect(() => {
    if (!hasFinnhubKey()) return;
    let alive = true;

    const sock = new ManagedSocket({
      urls: [finnhubWsUrl()],
      staleAfterMs: 90_000,
      onStatus: s => { if (alive) setConnectionState(s); },
      onOpen: send => send(JSON.stringify({ type: 'subscribe', symbol: inst.finnhubSymbol })),
      onMessage: raw => {
        if (!alive) return;
        let msg: { type?: string; data?: FinnhubTrade[]; msg?: string };
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'error') { setError(`Finnhub: ${msg.msg ?? 'stream error'}`); return; }
        if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;

        const trades = msg.data
          .filter(t => t.s === inst.finnhubSymbol && Number.isFinite(t.p) && t.p > 0)
          .sort((a, b) => a.t - b.t);
        if (trades.length === 0) return;

        let working = candlesRef.current;
        let live: Candle | null = null;
        let changed = false;
        for (const tr of trades) {
          // While history is still loading we only track price; bars are built afterwards.
          if (historyStateRef.current === 'loading') continue;
          const applied = applyTick(working, { price: tr.p, timeSec: Math.floor(tr.t / 1000), volume: tr.v }, tfRef.current);
          if (!applied) continue;
          if (historyStateRef.current === 'unavailable' && working.length === 0) {
            // first tick-built bar is partial → exclude it from analysis
            setAnalysisFloorTime(applied.live.time + TF_SECONDS[tfRef.current]);
          }
          working = applied.candles;
          live = applied.live;
          changed = true;
        }
        if (changed) {
          // Keep memory bounded on long sessions.
          if (working.length > 1500) working = working.slice(-1000);
          commit(working);
          if (live) setLiveCandle(live);
        }

        const last = trades[trades.length - 1];
        lastDataRef.current = Date.now();
        lastPriceRef.current = last.p;
        lastTickSecRef.current = Math.floor(last.t / 1000);

        const stats = statsRef.current;
        if (stats) {
          stats.high = Math.max(stats.high, last.p);
          stats.low = Math.min(stats.low, last.p);
        }
        setTicker({
          price: last.p,
          open: stats?.open ?? NaN,
          high: stats?.high ?? NaN,
          low: stats?.low ?? NaN,
          close: last.p,
          change: stats ? last.p - stats.open : NaN,
          changePercent: stats && stats.open > 0 ? ((last.p - stats.open) / stats.open) * 100 : NaN,
          timestamp: Math.floor(last.t / 1000),
        });
      },
    });
    sock.start();

    return () => { alive = false; sock.stop(); };
  }, [inst, reloadNonce, commit]);

  // ── Freshness / market-closed labelling ────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const last = lastDataRef.current;
      const f = assessFreshness(last, Date.now(), FX_FRESHNESS);
      setLastUpdate(prev => (prev === last ? prev : last));
      setFreshness(prev => (prev === f ? prev : f));
      // Weekend window only LABELS an already-silent feed; it never hides staleness.
      const closed = (f === 'stale' || f === 'dead' || f === 'none') && isFxWeekendWindow(new Date());
      setMarketClosed(prev => (prev === closed ? prev : closed));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const retry = useCallback(() => setReloadNonce(n => n + 1), []);

  return {
    candles, liveCandle, ticker, connectionState, loading, error, notice,
    freshness, lastUpdate, marketClosed, dataHealth, historySource, analysisFloorTime, retry,
  };
}
