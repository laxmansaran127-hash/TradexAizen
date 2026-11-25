import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import type { Candle } from '@/types/trading';
import type { ChartOverlay } from '@/lib/analysis/types';

interface AssetChartProps {
  candles: Candle[];
  liveCandle: Candle | null;
  fullscreen?: boolean;
  overlay?: ChartOverlay | null;
}

export function AssetChart({ candles, liveCandle, fullscreen, overlay }: AssetChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: 'Inter, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(30,41,59,0.5)' },
        horzLines: { color: 'rgba(30,41,59,0.5)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#475569', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#475569', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Create markers plugin for v5
    markersPluginRef.current = createSeriesMarkers(candleSeries, []);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lastCandleRef.current = null;
      priceLinesRef.current = [];
      markersPluginRef.current = null;
    };
  }, []);

  // Set historical data when it changes
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (candles.length === 0) return;

    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume || 0,
      color: c.close >= c.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
    }));

    // Wrapped in try/catch: prevents crash if chart was removed between render and this update
    try {
      candleSeriesRef.current.setData(candleData);
      volumeSeriesRef.current.setData(volumeData);
      lastCandleRef.current = candles[candles.length - 1];
      chartRef.current?.timeScale().scrollToRealTime();
    } catch { /* chart already removed */ }
  }, [candles]);

  // Update live candle in real time
  useEffect(() => {
    if (!liveCandle || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const last = lastCandleRef.current;

    // Wrapped in try/catch: prevents crash if chart was removed between render and this update
    try {
      if (last && last.time === liveCandle.time) {
        candleSeriesRef.current.update({
          time: liveCandle.time as UTCTimestamp,
          open: liveCandle.open,
          high: liveCandle.high,
          low: liveCandle.low,
          close: liveCandle.close,
        });
        volumeSeriesRef.current.update({
          time: liveCandle.time as UTCTimestamp,
          value: liveCandle.volume || 0,
          color: liveCandle.close >= liveCandle.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        });
      } else if (!last || liveCandle.time > last.time) {
        candleSeriesRef.current.update({
          time: liveCandle.time as UTCTimestamp,
          open: liveCandle.open,
          high: liveCandle.high,
          low: liveCandle.low,
          close: liveCandle.close,
        });
        volumeSeriesRef.current.update({
          time: liveCandle.time as UTCTimestamp,
          value: liveCandle.volume || 0,
          color: liveCandle.close >= liveCandle.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        });
      }
      lastCandleRef.current = liveCandle;
    } catch { /* chart already removed */ }
  }, [liveCandle]);

  // Apply / clear overlay (price lines + markers)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Remove existing price lines
    priceLinesRef.current.forEach(line => {
      try { series.removePriceLine(line); } catch { /* already removed */ }
    });
    priceLinesRef.current = [];

    if (!overlay) {
      markersPluginRef.current?.setMarkers([]);
      return;
    }

    // Add price lines — wrapped in try/catch to prevent crash if chart was removed
    try {
      for (const line of overlay.lines) {
        const pl = series.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: line.lineWidth as 1 | 2 | 3 | 4,
          lineStyle: line.lineStyle === 'solid' ? LineStyle.Solid
            : line.lineStyle === 'dashed' ? LineStyle.Dashed
            : LineStyle.Dotted,
          axisLabelVisible: true,
          title: line.title,
        });
        priceLinesRef.current.push(pl);
      }

      // Convert and set markers via plugin API
      const markers: SeriesMarker<Time>[] = overlay.markers.map(m => ({
        time: m.time as UTCTimestamp,
        position: m.position,
        color: m.color,
        shape: m.shape === 'circle' ? 'circle' : m.shape === 'square' ? 'square' : m.shape === 'arrowUp' ? 'arrowUp' : 'arrowDown',
        text: m.text,
      }));
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      markersPluginRef.current?.setMarkers(markers);
    } catch { /* chart already removed */ }
  }, [overlay]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: fullscreen ? '100%' : 300, height: fullscreen ? '100%' : '100%' }}
    />
  );
}
