import type { Asset, Timeframe } from '@/types/trading';

// ── Aizen × TradeXLive — core types ─────────────────────────────
// Pure data types: no React / DOM imports so the same code can run in a server worker later.

/** 'live' exists as a TYPE only. No live execution connector is implemented; see LIVE_TRADING_AVAILABLE. */
export type AizenMode = 'paper' | 'approval' | 'live';
export type AccountType = 'paper' | 'live';
export type MarketCategory = 'crypto' | 'forex' | 'gold';
export type Direction = 'long' | 'short';
export type EmergencyPolicy = 'freeze' | 'flatten';

/** Hard switch: there is no broker/exchange order connector in this project, so live trading cannot be enabled. */
export const LIVE_TRADING_AVAILABLE = false;

export interface RiskSettings {
  /** Virtual starting balance for the PAPER account (USD). */
  startingEquity: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  /** Block new trades while equity is this far (%) below its peak. */
  maxDrawdownPct: number;
  maxOpenPositions: number;
  /** Sum of open notional as % of equity. */
  maxTotalExposurePct: number;
  /** Max notional / equity for ONE position. */
  maxLeverage: number;
  maxConsecutiveLosses: number;
  maxTradesPerDay: number;
  minRewardToRisk: number;
  /** Reject when price has drifted from the planned entry by more than this many ATR. */
  maxEntryDriftAtr: number;
  maxSpreadBps: number;
  /** Reject trades when no news/calendar coverage exists (never trade blind). */
  requireNewsCoverage: boolean;
}

export interface ExecutionAssumptions {
  /** Fraction of the position closed at TP1/TP2/TP3 (must sum to 1). */
  scaleOut: [number, number, number];
  moveStopToBreakevenAfterTp1: boolean;
}

export interface AizenSettings {
  agentOn: boolean;
  mode: AizenMode;
  /** Chart timeframe the agent analyses. */
  timeframe: Timeframe;
  markets: Record<MarketCategory, boolean>;
  /** Assets the agent may trade (subset of the enabled categories). */
  assets: Asset[];
  risk: RiskSettings;
  execution: ExecutionAssumptions;
  emergencyStopped: boolean;
  emergencyPolicy: EmergencyPolicy;
}

export interface InstrumentSpec {
  assetId: Asset;
  displaySymbol: string;
  category: MarketCategory;
  /** USD/JPY: quantity is expressed in USD (the base currency). */
  baseIsUsd: boolean;
  quoteCcy: 'USD' | 'JPY';
  qtyStep: number;
  minNotionalUsd: number;
  /** Per-side commission assumption (bps of notional). Paper-trading ASSUMPTION, not a broker quote. */
  feeBps: number;
  /** Adverse slippage applied to market entries and stop exits (bps). ASSUMPTION. */
  slippageBps: number;
  /** Cost assumption when no bid/ask feed exists. ASSUMPTION. */
  assumedSpreadBps: number;
}

export type DecisionKind = 'LONG' | 'SHORT' | 'WAIT' | 'NO TRADE';

export interface AizenDecision {
  /** Deterministic: assetId:timeframe:asOf:direction — doubles as the idempotency key. */
  id: string;
  assetId: Asset;
  symbol: string;
  category: MarketCategory;
  timeframe: Timeframe;
  decision: DecisionKind;
  /** Open time (sec) of the last CLOSED candle the analysis used. */
  asOf: number | null;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  riskReward: number | null;
  atr: number | null;
  engineDecision: string;
  engineReason: string;
  /** Evidence lines built only from real, non-null analysis values. */
  reasoning: string[];
  gates: { name: string; passed: boolean; note: string }[];
  newsCoverage: string;
  feed: 'fresh' | 'stale';
  createdAt: number;
}

export interface RiskCheck { name: string; passed: boolean; note: string }

export interface RiskVerdict {
  approved: boolean;
  checks: RiskCheck[];
  qty: number;
  riskUsd: number;
  notionalUsd: number;
  leverage: number;
  /** Set when size was reduced to satisfy a cap (leverage / exposure). */
  sizeNote: string | null;
}

export interface FillLeg { time: number; price: number; qty: number; reason: string; fee: number; pnl: number }

export interface PaperPosition {
  id: string;
  /** Idempotency key (decision id). */
  orderKey: string;
  assetId: Asset;
  symbol: string;
  category: MarketCategory;
  direction: Direction;
  entryPrice: number;
  plannedEntry: number;
  qty: number;
  remainingQty: number;
  initialStop: number;
  stop: number;
  tp1: number; tp2: number; tp3: number;
  tpHit: 0 | 1 | 2 | 3;
  entryTime: number;
  timeframe: Timeframe;
  strategy: string;
  reasoning: string[];
  riskUsd: number;
  leverage: number;
  fees: number;
  realizedPnl: number;
  legs: FillLeg[];
  decisionId: string;
  /** Last closed bar time already processed by the monitor. */
  lastBarTime: number;
}

export type ExitReason = 'stop' | 'breakeven_stop' | 'tp3' | 'manual' | 'emergency_flatten';

export interface TradeRecord {
  id: string;
  accountType: AccountType;
  assetId: Asset;
  symbol: string;
  category: MarketCategory;
  direction: Direction;
  entryPrice: number;
  /** Quantity-weighted average exit price across all fills. */
  exitPrice: number;
  stopLoss: number;
  takeProfit: { tp1: number; tp2: number; tp3: number };
  qty: number;
  leverage: number;
  entryTime: number;
  exitTime: number;
  grossPnl: number;
  fees: number;
  /** Net of fees. */
  realizedPnl: number;
  outcome: 'win' | 'loss' | 'breakeven';
  rMultiple: number | null;
  strategy: string;
  timeframe: Timeframe;
  reasoning: string[];
  executionStatus: 'filled_paper';
  exitReason: ExitReason;
  decisionId: string;
  legs: FillLeg[];
}

export interface PendingOrder {
  id: string;
  decision: AizenDecision;
  createdAt: number;
  expiresAt: number;
}

export interface DecisionRecord {
  id: string;
  time: number;
  decision: AizenDecision;
  /** What the risk layer / executor did with it. */
  outcome: 'executed_paper' | 'pending_approval' | 'rejected_risk' | 'no_trade' | 'duplicate' | 'expired' | 'approved' | 'declined';
  rejectReasons: string[];
}

export interface RiskEvent { id: string; time: number; level: 'info' | 'warn' | 'block'; code: string; message: string }
export interface ExecLogEntry { id: string; time: number; kind: 'order' | 'fill' | 'close' | 'reject' | 'system'; message: string }

export interface AizenState {
  version: 1;
  accountType: 'paper';
  settings: AizenSettings;
  account: { startingEquity: number; balance: number; peakEquity: number };
  positions: PaperPosition[];
  pending: PendingOrder[];
  trades: TradeRecord[];
  decisions: DecisionRecord[];
  riskEvents: RiskEvent[];
  executionLog: ExecLogEntry[];
  seenOrderKeys: string[];
  lastAnalyzedBar: Record<string, number>;
  heartbeat: { lastCycleAt: number | null; lastError: string | null; cycles: number };
}

export interface PriceMap { [assetId: string]: number | undefined }
