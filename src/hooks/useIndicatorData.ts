import { useMemo } from 'react';
import type { Candle } from '@/types/trading';
import {
  ema, rsi, macd, atr, vwap, bollinger, adx, stochasticRsi,
} from '@/lib/indicators';
import {
  type IndicatorParams,
  type ComputedIndicators,
  type IndicatorSummaryData,
  EMA_COLORS,
} from '@/lib/indicatorConfig';

// Computes all indicator arrays from candle data using the user-adjustable params.
// Memoized on candles + params so it only recomputes when data or settings change.
export function useIndicatorData(
  candles: Candle[],
  params: IndicatorParams,
): { computed: ComputedIndicators | null; summary: IndicatorSummaryData | null } {
  return useMemo(() => {
    if (candles.length < 30) return { computed: null, summary: null };

    const periods = [params.ema1, params.ema2, params.ema3, params.ema4];
    const emaLines = periods.map((p, i) => ({
      period: p,
      color: EMA_COLORS[i],
      values: candles.length >= p ? ema(candles, p) : new Array(candles.length).fill(null),
    }));

    const bb = bollinger(candles, 20, 2);
    const rsiArr = rsi(candles, params.rsiPeriod);
    const macdR = macd(candles, 12, 26, 9);
    const atrArr = atr(candles, 14);
    const volArr = candles.map(c => c.volume ?? 0);
    const vwapArr = vwap(candles);
    const adxR = adx(candles, 14);
    const stochRsiR = stochasticRsi(candles, params.rsiPeriod, 14, 3, 3);

    const computed: ComputedIndicators = {
      emaLines,
      bollinger: { upper: bb.upper, mid: bb.mid, lower: bb.lower },
      rsi: rsiArr,
      macd: { macdLine: macdR.macdLine, signalLine: macdR.signalLine, histogram: macdR.histogram },
      atr: atrArr,
      volume: volArr,
      vwap: vwapArr,
      adx: { adx: adxR.adx, plusDI: adxR.plusDI, minusDI: adxR.minusDI },
      stochRsi: { k: stochRsiR.k, d: stochRsiR.d },
    };

    const last = (arr: (number | null)[]): number | null => {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null) return arr[i];
      }
      return null;
    };

    const summary: IndicatorSummaryData = {
      ema1: last(emaLines[0].values),
      ema2: last(emaLines[1].values),
      ema3: last(emaLines[2].values),
      ema4: last(emaLines[3].values),
      rsi: last(rsiArr),
      macdLine: last(macdR.macdLine),
      macdSignal: last(macdR.signalLine),
      macdHist: last(macdR.histogram),
      atr: last(atrArr),
      vwap: last(vwapArr),
      adx: last(adxR.adx),
      stochRsiK: last(stochRsiR.k),
      stochRsiD: last(stochRsiR.d),
      bbUpper: last(bb.upper),
      bbMid: last(bb.mid),
      bbLower: last(bb.lower),
    };

    return { computed, summary };
  }, [candles, params]);
}
