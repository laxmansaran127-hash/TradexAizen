// ── Indicator configuration for the additive indicator system ──
// These types and defaults power the indicator panels, summary, and
// settings drawer. They are separate from the existing IndicatorConfig
// in types.ts which drives the analysis engine.

export interface IndicatorParams {
  ema1: number;
  ema2: number;
  ema3: number;
  ema4: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
}

export const DEFAULT_PARAMS: IndicatorParams = {
  ema1: 20,
  ema2: 50,
  ema3: 100,
  ema4: 200,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
};

// Line data point for chart overlays
export interface LinePoint {
  time: number;
  value: number;
}

// A named line series for sub-panels
export interface IndicatorLine {
  name: string;
  color: string;
  data: LinePoint[];
}

// Computed indicator data — all arrays aligned to candle indices
export interface ComputedIndicators {
  emaLines: { period: number; color: string; values: (number | null)[] }[];
  bollinger: { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] };
  rsi: (number | null)[];
  macd: { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] };
  atr: (number | null)[];
  volume: number[];
  vwap: (number | null)[];
  adx: { adx: (number | null)[]; plusDI: (number | null)[]; minusDI: (number | null)[] };
  stochRsi: { k: (number | null)[]; d: (number | null)[] };
}

// Summary values for the read-only panel
export interface IndicatorSummaryData {
  ema1: number | null;
  ema2: number | null;
  ema3: number | null;
  ema4: number | null;
  rsi: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr: number | null;
  vwap: number | null;
  adx: number | null;
  stochRsiK: number | null;
  stochRsiD: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
}

// EMA color palette for chart overlays
export const EMA_COLORS = ['#38bdf8', '#a78bfa', '#fb923c', '#f472b6'];
export const BB_COLOR = 'rgba(148,163,184,0.3)';
