import { useState, useMemo } from 'react';
import type { Candle } from '@/types/trading';
import { useIndicatorData } from '@/hooks/useIndicatorData';
import { IndicatorSubPanel } from '@/components/IndicatorSubPanel';
import { IndicatorSummary } from '@/components/IndicatorSummary';
import { IndicatorSettings } from '@/components/IndicatorSettings';
import {
  type IndicatorParams,
  type IndicatorLine,
  type ComputedIndicators,
  DEFAULT_PARAMS,
  EMA_COLORS,
} from '@/lib/indicatorConfig';

interface IndicatorDashboardProps {
  candles: Candle[];
  decimals: number;
}

// Converts a (number|null)[] array + candle times into LinePoint[] for lightweight-charts
function toLinePoints(values: (number | null)[], candles: Candle[]): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = [];
  for (let i = 0; i < values.length && i < candles.length; i++) {
    if (values[i] !== null) {
      points.push({ time: candles[i].time, value: values[i]! });
    }
  }
  return points;
}

// Builds the EMA overlay lines for the main chart
export function buildEmaOverlayLines(computed: ComputedIndicators, candles: Candle[]): IndicatorLine[] {
  return computed.emaLines
    .filter(e => candles.length >= e.period)
    .map(e => ({
      name: `EMA ${e.period}`,
      color: e.color,
      data: toLinePoints(e.values, candles),
    }));
}

// Builds the Bollinger Bands overlay lines for the main chart
export function buildBollingerOverlayLines(computed: ComputedIndicators, candles: Candle[]): IndicatorLine[] {
  return [
    { name: 'BB Upper', color: 'rgba(148,163,184,0.5)', data: toLinePoints(computed.bollinger.upper, candles) },
    { name: 'BB Mid', color: 'rgba(148,163,184,0.3)', data: toLinePoints(computed.bollinger.mid, candles) },
    { name: 'BB Lower', color: 'rgba(148,163,184,0.5)', data: toLinePoints(computed.bollinger.lower, candles) },
  ];
}

// Self-contained indicator dashboard: renders sub-panels for each oscillator,
// a read-only summary, and a settings drawer for adjustable params.
// Mounted alongside existing widgets without modifying their logic.
export function IndicatorDashboard({ candles, decimals }: IndicatorDashboardProps) {
  const [params, setParams] = useState<IndicatorParams>(DEFAULT_PARAMS);
  const [showSettings, setShowSettings] = useState(false);
  const { computed, summary } = useIndicatorData(candles, params);

  const subPanels = useMemo(() => {
    if (!computed || candles.length < 30) return null;

    const toLine = (name: string, color: string, values: (number | null)[]): IndicatorLine => ({
      name, color, data: toLinePoints(values, candles),
    });

    return {
      rsi: [toLine(`RSI ${params.rsiPeriod}`, '#38bdf8', computed.rsi)],
      rsiRefs: [
        { price: params.rsiOverbought, color: 'rgba(239,68,68,0.4)' },
        { price: params.rsiOversold, color: 'rgba(34,197,94,0.4)' },
        { price: 50, color: 'rgba(148,163,184,0.2)', lineStyle: 'dotted' as const },
      ],
      macdLines: [
        toLine('MACD', '#38bdf8', computed.macd.macdLine),
        toLine('Signal', '#f59e0b', computed.macd.signalLine),
      ],
      macdHist: {
        data: candles.map((c, i) => {
          const h = computed.macd.histogram[i];
          return {
            time: c.time,
            value: h ?? 0,
            color: h !== null && h >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
          };
        }),
      },
      macdRefs: [{ price: 0, color: 'rgba(148,163,184,0.3)', lineStyle: 'dotted' as const }],
      atrLines: [toLine('ATR 14', '#fb923c', computed.atr)],
      volumeHist: {
        data: candles.map(c => ({
          time: c.time,
          value: c.volume ?? 0,
          color: c.close >= c.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        })),
      },
      vwapLines: [toLine('VWAP', '#a78bfa', computed.vwap)],
      adxLines: [
        toLine('ADX', '#f472b6', computed.adx.adx),
        toLine('+DI', 'rgba(34,197,94,0.6)', computed.adx.plusDI),
        toLine('-DI', 'rgba(239,68,68,0.6)', computed.adx.minusDI),
      ],
      adxRefs: [{ price: 25, color: 'rgba(148,163,184,0.3)', lineStyle: 'dotted' as const }],
      stochRsiLines: [
        toLine('%K', '#38bdf8', computed.stochRsi.k),
        toLine('%D', '#f59e0b', computed.stochRsi.d),
      ],
      stochRsiRefs: [
        { price: 80, color: 'rgba(239,68,68,0.4)' },
        { price: 20, color: 'rgba(34,197,94,0.4)' },
      ],
    };
  }, [computed, candles, params.rsiPeriod, params.rsiOverbought, params.rsiOversold]);

  if (!computed || !summary || !subPanels || candles.length < 30) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <p className="text-xs text-slate-500 text-center">Waiting for sufficient data to compute indicators...</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Technical Indicators</h3>
        <IndicatorSettings params={params} onChange={setParams} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-2">
        <div className="space-y-2">
          <IndicatorSubPanel title="RSI" lines={subPanels.rsi} refLines={subPanels.rsiRefs} height={100} precision={1} />
          <IndicatorSubPanel title="MACD (12, 26, 9)" lines={subPanels.macdLines} histogram={subPanels.macdHist} refLines={subPanels.macdRefs} height={100} precision={4} />
          <IndicatorSubPanel title="ATR 14" lines={subPanels.atrLines} height={80} precision={decimals} />
          <IndicatorSubPanel title="Volume" lines={[]} histogram={subPanels.volumeHist} height={80} />
          <IndicatorSubPanel title="VWAP" lines={subPanels.vwapLines} height={80} precision={decimals} />
          <IndicatorSubPanel title="ADX 14" lines={subPanels.adxLines} refLines={subPanels.adxRefs} height={100} precision={1} />
          <IndicatorSubPanel title="Stochastic RSI" lines={subPanels.stochRsiLines} refLines={subPanels.stochRsiRefs} height={100} precision={1} />
        </div>
        <div>
          <IndicatorSummary summary={summary} params={params} decimals={decimals} />
        </div>
      </div>
    </div>
  );
}

// Re-export for widgets that need to pass overlay lines to AssetChart
export { DEFAULT_PARAMS, EMA_COLORS, type IndicatorParams };
