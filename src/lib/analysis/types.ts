// ── Swing Points ────────────────────────────────────────────────

export interface SwingPoint {
  index: number;
  price: number;
  time: number;
  type: 'high' | 'low';
  confirmed: boolean;
}

// ── Market Structure ────────────────────────────────────────────

export type StructureLabel = 'HH' | 'HL' | 'LH' | 'LL';

export interface StructureEvent {
  type: 'BOS' | 'CHOCH' | 'MSS';
  direction: 'bullish' | 'bearish';
  /** Index of the candle whose CLOSE broke the level. */
  index: number;
  time: number;
  /** Close of the breaking candle. */
  price: number;
  /** The swing level that was broken. */
  level: number;
  /** Index of the swing that formed the broken level. */
  levelIndex?: number;
  /** True when the breaking candle was a displacement candle (range/body ≥ ~1.5 ATR). */
  displacement?: boolean;
}

export type StructureState = 'bullish' | 'bearish' | 'sideways' | 'transition';

export interface MarketStructureResult {
  swings: SwingPoint[];
  labels: { index: number; label: StructureLabel; price: number; time: number }[];
  events: StructureEvent[];
  currentBias: 'bullish' | 'bearish' | 'neutral';
  /** Bullish / Bearish / Sideways / Transition (recent CHOCH not yet confirmed by a BOS). */
  state?: StructureState;
  /** Most recent confirmed swing high/low that has not been broken (protected levels). */
  activeHigh?: SwingPoint | null;
  activeLow?: SwingPoint | null;
}

// ── Liquidity ───────────────────────────────────────────────────

export interface LiquidityLevel {
  type: 'buy-side' | 'sell-side';
  price: number;
  index: number;
  time: number;
  swept: boolean;
  sweepIndex?: number;
  sweepTime?: number;
  /** Post-sweep reaction: price left the level by ≥0.75 ATR within 5 bars (confirmed),
   *  not enough bars yet (pending) or it failed / was broken by a close (none). */
  reaction?: 'confirmed' | 'pending' | 'none';
  /** True when this level is made of ≥2 equal highs/lows. */
  equal?: boolean;
}

export interface LiquidityResult {
  levels: LiquidityLevel[];
  equalHighs: { price: number; indices: number[]; time: number }[];
  equalLows: { price: number; indices: number[]; time: number }[];
  recentSweep: LiquidityLevel | null;
}

// ── Support / Resistance ────────────────────────────────────────

export interface SRLevel {
  type: 'support' | 'resistance';
  price: number;
  strength: number;
  index: number;
  time: number;
  tested: number;
  breakout: boolean;
  retest: boolean;
  /** Candle rejections (touch followed by a close away from the level). */
  rejections?: number;
  /** Zone edges (cluster of swing prices). */
  zoneLow?: number;
  zoneHigh?: number;
  /** Broken level that now acts in the opposite role (support↔resistance). */
  flipped?: boolean;
}

// ── Supply / Demand ─────────────────────────────────────────────

export interface Zone {
  type: 'supply' | 'demand';
  top: number;
  bottom: number;
  index: number;
  time: number;
  fresh: boolean;
  mitigated: boolean;
  mitigatedIndex?: number;
  /** Number of separate returns into the zone after it formed. */
  retests?: number;
  /** A close beyond the distal edge invalidated the zone. */
  invalidated?: boolean;
  /** Price that invalidates the zone (distal edge). */
  invalidationPrice?: number;
  /** Impulse size in ATR multiples that created the zone. */
  impulseAtr?: number;
  strength?: 'strong' | 'moderate' | 'weak';
  /** Plain-language origin of the zone. */
  origin?: string;
}

// ── Chart Patterns ──────────────────────────────────────────────

export interface ChartPattern {
  name: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  startIndex: number;
  endIndex: number;
  confidence: number;
  keyLevels: { label: string; price: number; index: number; time: number }[];
  description: string;
  confirmed: boolean;
  /** Price beyond which the pattern is no longer valid. */
  invalidation?: number;
  /** What confirmed (or still needs to confirm) the pattern. */
  confirmation?: string;
  /** Whether the pattern direction agrees with structure / higher-timeframe context. */
  context?: 'with-trend' | 'counter-trend' | 'neutral';
}

// ── Candlestick Patterns ────────────────────────────────────────

export interface CandlePattern {
  name: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  index: number;
  time: number;
  description: string;
  /** Candle sits at a swing level / S-R / zone (the only place reversal candles carry weight). */
  atKeyLevel?: boolean;
}

// ── Indicators ──────────────────────────────────────────────────

export interface IndicatorSnapshot {
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  rsi: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr: number | null;
  vwap: number | null;
  adx?: number | null;
  plusDI?: number | null;
  minusDI?: number | null;
  bbUpper?: number | null;
  bbMid?: number | null;
  bbLower?: number | null;
  /** (upper-lower)/mid in percent. */
  bbWidthPct?: number | null;
  stochRsiK?: number | null;
  stochRsiD?: number | null;
  /** Last closed candle volume vs its 20-bar average (null when the feed has no real volume). */
  volumeRatio?: number | null;
}

// ── Trade Setup ─────────────────────────────────────────────────

export interface TradeSetup {
  direction: 'long' | 'short';
  entryZone: { low: number; high: number };
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  invalidation: number;
  /** R:R to TP2 (kept for backwards compatibility). */
  riskReward: number;
  // ── additive, evidence-based detail ──
  entry?: number;
  riskDistance?: number;
  stopAtrMultiple?: number;
  rrTp1?: number;
  rrTp2?: number;
  rrTp3?: number;
  /** Where each target came from: a real structural level or an R-multiple projection. */
  tpBasis?: [TargetBasis, TargetBasis, TargetBasis];
  stopBasis?: string;
  riskGuidance?: string;
}

export interface TargetBasis { kind: 'structure' | 'projection'; label: string }

// ── Evidence / decision ─────────────────────────────────────────

export type EvidenceState = 'strong' | 'moderate' | 'weak' | 'conflicting' | 'insufficient';

export interface EvidenceItem {
  factor: string;
  stance: 'bullish' | 'bearish' | 'neutral';
  weight: number;
  note: string;
}

export interface GateResult {
  name: string;
  passed: boolean;
  note: string;
}

export interface EvidenceSummary {
  state: EvidenceState;
  bullishPoints: number;
  bearishPoints: number;
  items: EvidenceItem[];
  gates: GateResult[];
  explanation: string;
}

// ── Multi-timeframe ─────────────────────────────────────────────

export interface TimeframeContext {
  timeframe: string;
  role: 'higher' | 'middle' | 'entry';
  bias: 'bullish' | 'bearish' | 'sideways' | 'transition';
  lastEvent?: string;
  trend: 'bullish' | 'bearish' | 'sideways';
  keyHigh?: number;
  keyLow?: number;
  candles: number;
}

export interface MtfContext {
  higher: TimeframeContext | null;
  middle: TimeframeContext | null;
  entry: TimeframeContext;
  alignment: 'aligned-bullish' | 'aligned-bearish' | 'conflicting' | 'partial' | 'unavailable';
  notes: string[];
}

// ── News risk ───────────────────────────────────────────────────

export type NewsRiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface NewsRiskDetail {
  level: NewsRiskLevel;
  phase: 'BEFORE' | 'DURING' | 'AFTER' | null;
  drivers: string[];
  /** What the assessment is based on. 'none' ⇒ NEWS DATA UNAVAILABLE. */
  coverage: 'calendar+headlines' | 'calendar' | 'headlines-only' | 'none';
  nextEvent?: { title: string; currency: string; time: number; impact: 'HIGH' | 'MEDIUM' | 'LOW' };
}

// ── Breakouts / retests, momentum, volatility ───────────────────

export interface BreakoutEvent {
  type: 'breakout' | 'confirmed-breakout' | 'false-breakout' | 'retest-held' | 'failed-retest';
  direction: 'bullish' | 'bearish';
  level: number;
  index: number;
  time: number;
  note: string;
}

export interface DivergenceSignal {
  type: 'bullish' | 'bearish';
  source: 'RSI' | 'MACD';
  priceFrom: number;
  priceTo: number;
  oscFrom: number;
  oscTo: number;
  indexFrom: number;
  indexTo: number;
}

export interface MomentumResult {
  direction: 'bullish' | 'bearish' | 'neutral';
  state: 'strengthening' | 'weakening' | 'flat';
  divergences: DivergenceSignal[];
  notes: string[];
}

export interface VolatilityResult {
  atr: number | null;
  atrPercent: number | null;
  regime: 'low' | 'normal' | 'high' | 'extreme' | 'unknown';
  trend: 'expanding' | 'contracting' | 'stable' | 'unknown';
  lastBarAtrMultiple: number | null;
  /** Minimum sensible stop distance in price units (1.5 × ATR). */
  minStopDistance: number | null;
  notes: string[];
}

// ── Full Analysis Result ────────────────────────────────────────

export type FinalDecision = 'BUY' | 'SELL' | 'WAIT' | 'NO TRADE';

export interface AnalysisResult {
  // Chart summary
  symbol: string;
  timeframe: string;
  candleCount: number;
  lastPrice: number;
  // What happened
  summary: string;
  // Market structure
  structure: MarketStructureResult;
  // Trend
  trend: 'bullish' | 'bearish' | 'sideways' | 'transition';
  trendStrength: 'strong' | 'moderate' | 'weak';
  // Support / Resistance
  supportLevels: SRLevel[];
  resistanceLevels: SRLevel[];
  // Liquidity
  liquidity: LiquidityResult;
  // Supply / Demand
  zones: Zone[];
  // Chart patterns
  chartPatterns: ChartPattern[];
  // Candlestick patterns
  candlePatterns: CandlePattern[];
  // Indicators
  indicators: IndicatorSnapshot;
  // Scenarios
  bullishScenario: string;
  bearishScenario: string;
  // Trade setup
  tradeSetup: TradeSetup | null;
  // News risk
  newsRisk: NewsRiskLevel;
  // Final decision
  decision: FinalDecision;
  decisionReason: string;
  // ── additive fields (all optional so older consumers keep working) ──
  decimals?: number;
  /** Open time of the last CLOSED candle analysed (the forming bar is excluded). */
  asOf?: number;
  evidence?: EvidenceSummary;
  mtf?: MtfContext | null;
  newsRiskDetail?: NewsRiskDetail;
  breakouts?: BreakoutEvent[];
  momentum?: MomentumResult;
  volatility?: VolatilityResult;
  dataNotes?: string[];
  /** Set instead of a full analysis when data is unusable. */
  unavailableReason?: string;
}

// ── Chart Overlay Data ──────────────────────────────────────────

export interface OverlayLine {
  price: number;
  color: string;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  lineWidth: number;
  title: string;
}

export interface OverlayMarker {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown';
  text: string;
}

export interface OverlayZone {
  time: number;
  top: number;
  bottom: number;
  color: string;
}

export interface ChartOverlay {
  lines: OverlayLine[];
  markers: OverlayMarker[];
  zones: OverlayZone[];
}
