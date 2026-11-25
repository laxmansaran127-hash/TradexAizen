import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import type { IndicatorLine } from '@/lib/indicatorConfig';

interface IndicatorSubPanelProps {
  title: string;
  lines: IndicatorLine[];
  histogram?: { data: { time: number; value: number; color?: string }[] };
  height?: number;
  // Optional horizontal reference lines (e.g. RSI 70/30, MACD 0)
  refLines?: { price: number; color: string; lineStyle?: 'dashed' | 'dotted' }[];
  // Price scale precision override
  precision?: number;
}

// Renders a single oscillator or indicator in its own lightweight-charts
// instance below the main chart. Each panel is self-contained.
export function IndicatorSubPanel({
  title,
  lines,
  histogram,
  height = 120,
  refLines = [],
  precision,
}: IndicatorSubPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<'Line' | 'Histogram'>[]>([]);
  const refLineRefs = useRef<{ series: ISeriesApi<'Line'>; line: ReturnType<ISeriesApi<'Line'>['createPriceLine']> }[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
        fontSize: 10,
        fontFamily: 'Inter, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(30,41,59,0.3)' },
        horzLines: { color: 'rgba(30,41,59,0.3)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#475569', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#475569', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    // Precision is applied per-series via priceFormat, not on the price scale

    chartRef.current = chart;

    const newSeries: ISeriesApi<'Line' | 'Histogram'>[] = [];

    if (histogram) {
      const hist = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'price', precision: precision ?? 2, minMove: 1 / Math.pow(10, precision ?? 2) },
      });
      try { hist.setData(histogram.data as never); } catch { /* empty */ }
      newSeries.push(hist);
    }

    for (const line of lines) {
      const series = chart.addSeries(LineSeries, {
        color: line.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      try { series.setData(line.data as never); } catch { /* empty */ }
      newSeries.push(series);
    }

    seriesRefs.current = newSeries;

    // Add reference price lines
    refLineRefs.current = [];
    for (const ref of refLines) {
      if (newSeries.length > 0) {
        const lineSeries = newSeries[0] as ISeriesApi<'Line'>;
        const pl = lineSeries.createPriceLine({
          price: ref.price,
          color: ref.color,
          lineWidth: 1,
          lineStyle: ref.lineStyle === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        });
        refLineRefs.current.push({ series: lineSeries, line: pl });
      }
    }

    chart.timeScale().scrollToRealTime();

    return () => {
      try { chart.remove(); } catch { /* already removed */ }
      chartRef.current = null;
      seriesRefs.current = [];
      refLineRefs.current = [];
    };
  }, []);

  // Update data when lines/histogram change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || seriesRefs.current.length === 0) return;

    try {
      let seriesIdx = 0;
      if (histogram && seriesRefs.current[seriesIdx]) {
        (seriesRefs.current[seriesIdx] as ISeriesApi<'Histogram'>).setData(histogram.data as never);
        seriesIdx++;
      }
      for (let i = 0; i < lines.length && seriesIdx < seriesRefs.current.length; i++, seriesIdx++) {
        (seriesRefs.current[seriesIdx] as ISeriesApi<'Line'>).setData(lines[i].data as never);
      }
      chart.timeScale().scrollToRealTime();
    } catch { /* chart removed during update */ }
  }, [lines, histogram]);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{title}</span>
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}
