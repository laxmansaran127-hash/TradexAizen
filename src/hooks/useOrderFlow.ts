import { useState, useEffect, useRef, useCallback } from 'react';
import { ManagedSocket } from '@/lib/data/managedSocket';
import { aggTradeStreamUrls } from '@/lib/data/binance';
import type { Timeframe, ConnectionState } from '@/types/trading';
import { TF_SECONDS, ASSET_CONFIGS } from '@/types/trading';

const BTC_SYMBOL = ASSET_CONFIGS.find(a => a.id === 'BTC')!.symbol.toLowerCase();

export interface PriceLevel {
  price: number;
  buyVolume: number;
  sellVolume: number;
  buyCount: number;
  sellCount: number;
}

export interface OrderFlowData {
  levels: PriceLevel[];
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cvd: number;
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  vwap: number;
  candleStart: number;
  candleEnd: number;
  lastPrice: number;
  lastUpdate: number;
  /** Epoch seconds from which trades have been accumulated for the current candle.
   *  Later than candleStart ⇒ the candle is only PARTIALLY covered (page opened or
   *  connection resumed mid-candle); the UI must say so. */
  trackingSince: number;
}

interface AggTrade {
  e: string;        // event type
  a: number;        // aggregated trade id
  p: string;        // price
  q: string;        // quantity
  f: number;        // first trade id
  l: number;        // last trade id
  T: number;        // trade time (ms)
  m: boolean;       // is the buyer the market maker? (true = sell side)
}

function alignToTf(timeSec: number, tfSec: number): number {
  return Math.floor(timeSec / tfSec) * tfSec;
}

function priceKey(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

// Tick sizes for BTC — round to nearest $1 for footprint grouping
const TICK_SIZE = 1;

export function useOrderFlow(timeframe: Timeframe): {
  data: OrderFlowData | null;
  connectionState: ConnectionState;
} {
  const [data, setData] = useState<OrderFlowData | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  const tfRef = useRef(timeframe);
  const candleStartRef = useRef(0);
  const sinceRef = useRef(0);
  const dirtyRef = useRef(true);
  const levelsRef = useRef<Map<number, PriceLevel>>(new Map());
  const buyVolRef = useRef(0);
  const sellVolRef = useRef(0);
  const buyTradesRef = useRef(0);
  const sellTradesRef = useRef(0);
  const cvdRef = useRef(0);
  const cumPVRef = useRef(0);
  const cumVolRef = useRef(0);
  const lastPriceRef = useRef(0);
  const lastUpdateRef = useRef(0);

  const reset = useCallback((candleStart: number, since: number) => {
    candleStartRef.current = candleStart;
    sinceRef.current = since;
    levelsRef.current = new Map();
    buyVolRef.current = 0; sellVolRef.current = 0;
    buyTradesRef.current = 0; sellTradesRef.current = 0;
    cvdRef.current = 0; cumPVRef.current = 0; cumVolRef.current = 0;
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    tfRef.current = timeframe;
    const now = Math.floor(Date.now() / 1000);
    reset(alignToTf(now, TF_SECONDS[timeframe]), now); // partial: starts now
  }, [timeframe, reset]);

  const flushSnapshot = useCallback(() => {
    const tfSec = TF_SECONDS[tfRef.current];
    const now = Math.floor(Date.now() / 1000);
    const aligned = alignToTf(now, tfSec);
    // Roll to a new candle period. We were connected through the boundary, so the new
    // candle is fully covered from its first second.
    if (aligned > candleStartRef.current) reset(aligned, aligned);
    if (!dirtyRef.current) return;
    dirtyRef.current = false;

    const levels = Array.from(levelsRef.current.values()).sort((a, b) => b.price - a.price);
    setData({
      levels,
      buyVolume: buyVolRef.current,
      sellVolume: sellVolRef.current,
      delta: buyVolRef.current - sellVolRef.current,
      cvd: cvdRef.current,
      totalTrades: buyTradesRef.current + sellTradesRef.current,
      buyTrades: buyTradesRef.current,
      sellTrades: sellTradesRef.current,
      vwap: cumVolRef.current > 0 ? cumPVRef.current / cumVolRef.current : 0,
      candleStart: candleStartRef.current,
      candleEnd: candleStartRef.current + tfSec,
      lastPrice: lastPriceRef.current,
      lastUpdate: lastUpdateRef.current,
      trackingSince: sinceRef.current,
    });
  }, [reset]);

  // Binance aggTrade stream via the shared managed socket (mirror rotation, backoff,
  // stale-stream watchdog, no zombie reconnects).
  useEffect(() => {
    let alive = true;
    let wasDown = false;

    const sock = new ManagedSocket({
      urls: aggTradeStreamUrls(BTC_SYMBOL),
      staleAfterMs: 30_000,
      onStatus: s => {
        if (!alive) return;
        setConnectionState(s);
        if (s === 'reconnecting' || s === 'disconnected') wasDown = true;
        if (s === 'live' && wasDown) {
          // Trades were missed while down: the running totals would be wrong, so restart
          // them and report the candle as partially covered from now.
          wasDown = false;
          const now = Math.floor(Date.now() / 1000);
          reset(alignToTf(now, TF_SECONDS[tfRef.current]), now);
        }
      },
      onMessage: raw => {
        const trade = JSON.parse(raw) as AggTrade;
        if (trade.e !== 'aggTrade') return;
        const price = parseFloat(trade.p);
        const qty = parseFloat(trade.q);
        if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return;

        const timeSec = Math.floor(trade.T / 1000);
        const aligned = alignToTf(timeSec, TF_SECONDS[tfRef.current]);
        if (aligned < candleStartRef.current) return;                 // late trade from a previous candle
        if (aligned > candleStartRef.current) reset(aligned, aligned); // new candle

        const isBuy = !trade.m; // m=true: buyer is the maker → the aggressor was a seller
        const key = priceKey(price, TICK_SIZE);
        let level = levelsRef.current.get(key);
        if (!level) {
          level = { price: key, buyVolume: 0, sellVolume: 0, buyCount: 0, sellCount: 0 };
          levelsRef.current.set(key, level);
        }
        if (isBuy) {
          level.buyVolume += qty; level.buyCount++;
          buyVolRef.current += qty; buyTradesRef.current++; cvdRef.current += qty;
        } else {
          level.sellVolume += qty; level.sellCount++;
          sellVolRef.current += qty; sellTradesRef.current++; cvdRef.current -= qty;
        }
        cumPVRef.current += price * qty;
        cumVolRef.current += qty;
        lastPriceRef.current = price;
        lastUpdateRef.current = timeSec;
        dirtyRef.current = true;
      },
    });
    sock.start();
    const timer = setInterval(flushSnapshot, 200);

    return () => { alive = false; sock.stop(); clearInterval(timer); };
  }, [flushSnapshot, reset]);

  return { data, connectionState };
}
