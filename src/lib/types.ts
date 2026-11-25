// ── Core market data types ──────────────────────────────────────

import type { Timeframe as TradingTimeframe } from '@/types/trading';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = TradingTimeframe;

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  close: number;
  volume: number;
  marketStatus: 'open' | 'closed' | 'pre' | 'after';
  lastUpdate: number;
}

export interface MarketSymbol {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
}

// ── Indicators ──────────────────────────────────────────────────

export type IndicatorType =
  | 'SMA' | 'EMA' | 'VWAP' | 'RSI' | 'MACD' | 'BOLL'
  | 'ATR' | 'STOCH' | 'SUPERTREND' | 'VOLUME';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  period: number;
  period2?: number;
  period3?: number;
  color: string;
  visible: boolean;
}

// ── Alerts ──────────────────────────────────────────────────────

export type AlertType = 'price' | 'percent' | 'rsi' | 'volume' | 'breakout';
export type AlertCondition = 'crosses_above' | 'crosses_below';

export interface Alert {
  id: string;
  symbol: string;
  alert_type: AlertType;
  condition: AlertCondition;
  target: number;
  active: boolean;
  triggered: boolean;
  triggered_at: string | null;
  created_at: string;
}

// ── Connection ──────────────────────────────────────────────────

export type ConnectionState = 'live' | 'connecting' | 'reconnecting' | 'disconnected';

// ── User settings ───────────────────────────────────────────────

export interface UserSettings {
  demo_mode: boolean;
  notifications_enabled: boolean;
  sound_enabled: boolean;
  theme: string;
}
