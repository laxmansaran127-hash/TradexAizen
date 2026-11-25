import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { IndicatorSummaryData, IndicatorParams } from '@/lib/indicatorConfig';

interface IndicatorSummaryProps {
  summary: IndicatorSummaryData;
  params: IndicatorParams;
  decimals: number;
}

function fmt(v: number | null, decimals: number): string {
  if (v === null) return '—';
  return v.toFixed(decimals);
}

function macdSignal(hist: number | null, macdLine: number | null, signal: number | null): string {
  if (macdLine === null || signal === null) return '—';
  if (hist === null) return '—';
  if (hist > 0 && macdLine > signal) return 'Bullish';
  if (hist < 0 && macdLine < signal) return 'Bearish';
  return 'Neutral';
}

function adxSignal(adxVal: number | null): string {
  if (adxVal === null) return '—';
  if (adxVal >= 25) return `${adxVal.toFixed(1)} — Trending`;
  if (adxVal >= 20) return `${adxVal.toFixed(1)} — Weak trend`;
  return `${adxVal.toFixed(1)} — Ranging`;
}

function rsiSignal(rsiVal: number | null, ob: number, os: number): string {
  if (rsiVal === null) return '—';
  if (rsiVal >= ob) return `${rsiVal.toFixed(1)} — Overbought`;
  if (rsiVal <= os) return `${rsiVal.toFixed(1)} — Oversold`;
  if (rsiVal >= 50) return `${rsiVal.toFixed(1)} — Bullish`;
  return `${rsiVal.toFixed(1)} — Bearish`;
}

// Read-only indicator summary card — displays current computed values
// for manual interpretation. Does not generate BUY/SELL signals.
export function IndicatorSummary({ summary, params, decimals }: IndicatorSummaryProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2"
      >
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Indicator Summary</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <SummaryRow label={`EMA ${params.ema1}`} value={fmt(summary.ema1, decimals)} />
            <SummaryRow label={`EMA ${params.ema2}`} value={fmt(summary.ema2, decimals)} />
            <SummaryRow label={`EMA ${params.ema3}`} value={fmt(summary.ema3, decimals)} />
            <SummaryRow label={`EMA ${params.ema4}`} value={fmt(summary.ema4, decimals)} />
          </div>
          <div className="h-px bg-slate-800" />
          <SummaryRow label={`RSI ${params.rsiPeriod}`} value={rsiSignal(summary.rsi, params.rsiOverbought, params.rsiOversold)} />
          <SummaryRow label="MACD (12,26,9)" value={`${fmt(summary.macdHist, 4)} — ${macdSignal(summary.macdHist, summary.macdLine, summary.macdSignal)}`} />
          <SummaryRow label="ATR 14" value={fmt(summary.atr, decimals)} />
          <SummaryRow label="VWAP" value={fmt(summary.vwap, decimals)} />
          <SummaryRow label="ADX 14" value={adxSignal(summary.adx)} />
          <SummaryRow label="Stoch RSI %K" value={fmt(summary.stochRsiK, 1)} />
          <SummaryRow label="Stoch RSI %D" value={fmt(summary.stochRsiD, 1)} />
          <div className="h-px bg-slate-800" />
          <SummaryRow label="BB Upper" value={fmt(summary.bbUpper, decimals)} />
          <SummaryRow label="BB Mid" value={fmt(summary.bbMid, decimals)} />
          <SummaryRow label="BB Lower" value={fmt(summary.bbLower, decimals)} />
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-mono">{value}</span>
    </div>
  );
}
