import { useState, useEffect, useRef, useCallback } from 'react';
import type { Candle, TickerData, Timeframe, ConnectionState } from '@/types/trading';
import { ASSET_CONFIGS, TF_SECONDS, BINANCE_INTERVAL_MAP } from '@/types/trading';
import { ManagedSocket } from '@/lib/data/managedSocket';
import {
  combinedStreamUrls,
  fetchBinanceKlines,
  mergeCandle,
  mergeCandleLists,
  parseBinanceFrame,
} from '@/lib/data/binance';
import {
  assessFreshness,
  assessSeriesHealth,
  CRYPTO_FRESHNESS,
  sanitizeCandles,
  validateCandle,
  type DataHealth,
  type Freshness,
} from '@/lib/data/validation';

const BTC_SYMBOL = ASSET_CONFIGS.find(a => a.id === 'BTC')!.symbol; // BTCUSDT
const HISTORY_LIMIT = 500;

/**
 * Real-time crypto chart feed (Binance spot).
 *
 * Reliability properties:
 *  - one ManagedSocket per (symbol, timeframe); torn down on change/unmount;
 *  - history reloads when EITHER symbol or timeframe changes (previously the
 *    symbol change was ignored and the old asset's candles stayed on screen);
 *  - in-flight REST calls are aborted on change (no stale response overwrite);
 *  - all candles are validated; invalid ones are rejected, never "fixed";
 *  - gaps after a reconnect are back-filled from REST;
 *  - freshness (fresh/stale/dead) is tracked from message time.
 *
 * `candles` includes the still-forming last bar (the chart needs it). The
 * analysis engine drops it before use.
 */
export function useBinanceChart(timeframe: Timeframe, symbol?: string) {
  const tradingSymbol = symbol || BTC_SYMBOL;

  const [candles, setCandles] = useState<Candle[]>([]);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Freshness>('none');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [dataHealth, setDataHealth] = useState<DataHealth>({ level: 'ok', reasons: [] });
  const [reloadNonce, setReloadNonce] = useState(0);

  const candlesRef = useRef<Candle[]>([]);
  const liveRef = useRef<Candle | null>(null);
  const lastDataRef = useRef<number | null>(null);
  const socketRef = useRef<ManagedSocket | null>(null);
  const backfillRef = useRef<() => void>(() => {});

  const commitCandles = useCallback((next: Candle[]) => {
    candlesRef.current = next;
    setCandles(next);
  }, []);

  // ── Reset per-symbol state immediately when the symbol changes ──────────
  useEffect(() => {
    setTicker(null);
    setLastUpdate(null);
    lastDataRef.current = null;
    setFreshness('none');
  }, [tradingSymbol]);

  // ── Historical candles (REST) ───────────────────────────────────────────
  useEffect(() => {
    const ctl = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);
    commitCandles([]);
    liveRef.current = null;
    setLiveCandle(null);

    (async () => {
      try {
        const rows = await fetchBinanceKlines(tradingSymbol, timeframe, HISTORY_LIMIT, ctl.signal);
        if (cancelled) return;
        const result = sanitizeCandles(rows, { timeframe, continuous: true, maxJump: 0.5 });
        if (result.candles.length === 0) throw new Error('Provider returned no valid candles');

        let merged = result.candles;
        const live = liveRef.current;
        if (live && live.time >= merged[merged.length - 1].time) merged = mergeCandle(merged, live);

        commitCandles(merged);
        setLiveCandle(live && live.time >= merged[merged.length - 1].time ? live : merged[merged.length - 1]);
        setDataHealth(assessSeriesHealth(result, { minCandles: 30, continuous: true }));
        setLoading(false);

        // Gap healing: used after reconnects and when a closed bar skips ahead.
        backfillRef.current = async () => {
          try {
            const recent = await fetchBinanceKlines(tradingSymbol, timeframe, 100, ctl.signal);
            if (cancelled) return;
            const clean = sanitizeCandles(recent, { timeframe, continuous: true, maxJump: 0.5 }).candles;
            if (clean.length) commitCandles(mergeCandleLists(candlesRef.current, clean));
          } catch { /* transient — next reconnect/closed bar retries */ }
        };
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        setError(`Failed to load ${tradingSymbol} candles: ${(err as Error).message}`);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ctl.abort();
      backfillRef.current = () => {};
    };
  }, [tradingSymbol, timeframe, reloadNonce, commitCandles]);

  // ── Live stream (WebSocket) ─────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    let wasDown = false;
    const interval = BINANCE_INTERVAL_MAP[timeframe];
    const tfSec = TF_SECONDS[timeframe];

    const sock = new ManagedSocket({
      urls: combinedStreamUrls(tradingSymbol, timeframe),
      staleAfterMs: 20_000,
      onStatus: s => {
        if (!alive) return;
        setConnectionState(s);
        if (s === 'reconnecting' || s === 'disconnected') wasDown = true;
        if (s === 'live' && wasDown) { wasDown = false; backfillRef.current(); }
      },
      onMessage: raw => {
        if (!alive) return;
        let frame: ReturnType<typeof parseBinanceFrame>;
        try { frame = parseBinanceFrame(raw); } catch { return; }

        const now = Date.now();
        const { kline, ticker: t } = frame;

        if (kline && kline.symbol === tradingSymbol.toUpperCase() && kline.interval === interval) {
          if (validateCandle(kline.candle)) return; // reject invalid tick
          lastDataRef.current = now;
          liveRef.current = kline.candle;
          setLiveCandle(kline.candle);

          if (kline.closed && candlesRef.current.length > 0) {
            const last = candlesRef.current[candlesRef.current.length - 1];
            if (kline.candle.time - last.time > tfSec) backfillRef.current(); // skipped bar(s)
            commitCandles(mergeCandle(candlesRef.current, kline.candle));
          }
        }

        if (t && t.symbol === tradingSymbol.toUpperCase() && t.price > 0 && Number.isFinite(t.price)) {
          lastDataRef.current = now;
          setTicker({
            price: t.price, open: t.open, high: t.high, low: t.low, close: t.price,
            volume: t.volume, change: t.change, changePercent: t.changePercent,
            timestamp: Math.floor(t.eventMs / 1000),
          });
        }
      },
    });
    socketRef.current = sock;
    sock.start();

    return () => {
      alive = false;
      sock.stop();
      if (socketRef.current === sock) socketRef.current = null;
    };
  }, [tradingSymbol, timeframe, reloadNonce, commitCandles]);

  // ── Freshness ticker (cheap; only sets state on change) ─────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const last = lastDataRef.current;
      setLastUpdate(prev => (prev === last ? prev : last));
      setFreshness(prev => {
        const next = assessFreshness(last, Date.now(), CRYPTO_FRESHNESS);
        return prev === next ? prev : next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const retry = useCallback(() => setReloadNonce(n => n + 1), []);

  return { candles, liveCandle, ticker, connectionState, loading, error, freshness, lastUpdate, dataHealth, retry };
}
