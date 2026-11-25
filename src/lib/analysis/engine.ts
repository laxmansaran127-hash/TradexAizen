import type { Candle, Timeframe } from '@/types/trading';
import type {
  AnalysisResult, ChartOverlay, IndicatorSnapshot, MtfContext, NewsRiskDetail, EvidenceSummary,
} from './types';
import { analyzeStructure } from './swings';
import { detectLiquidity, detectSupportResistance, detectZones, currentAtr } from './liquidity';
import { detectChartPatterns, enrichChartPatterns } from './patterns';
import { detectCandlePatterns } from './candlesticks';
import { analyzeMomentum, analyzeVolatility } from './momentum';
import { detectBreakouts } from './breakouts';
import { buildTimeframeContext, combineMtf, getContextTimeframes } from './mtf';
import { decide, type FeedFreshness } from './decision';
import { ema, rsi, macd, atr, vwap, bollinger, adx, stochasticRsi } from '@/lib/indicators';
import {
  assessSeriesHealth, dropFormingCandle, sanitizeCandles,
} from '@/lib/data/validation';

// ── Main Analysis Engine ────────────────────────────────────────
// Input candles are validated, the still-forming bar is removed, and only then
// does the pipeline run. If the data cannot be trusted the result is
// NO TRADE with an explicit "data unavailable" reason — never a guess.

export interface AnalysisContext {
  decimals?: number;
  kind?: 'crypto' | 'fx' | 'metal';
  /** Live-feed freshness at the moment of analysis. */
  feed?: FeedFreshness;
  news?: NewsRiskDetail;
  /** Candles of the context timeframes (each on its OWN timeframe). */
  contextCandles?: { middle?: Candle[] | null; higher?: Candle[] | null };
  /** Ignore candles opened before this time (partial tick-built bars). */
  floorTime?: number | null;
  maxJump?: number;
  nowSec?: number;
}

const MIN_CANDLES = 50;

const UNKNOWN_NEWS: NewsRiskDetail = {
  level: 'unknown', phase: null, coverage: 'none',
  drivers: ['NEWS DATA UNAVAILABLE — news was not supplied to the analysis'],
};

export function runAnalysis(
  rawCandles: Candle[],
  symbol: string,
  timeframe: string,
  ctx: AnalysisContext = {},
): AnalysisResult | null {
  if (rawCandles.length === 0) return null;
  const tf = timeframe as Timeframe;
  const kind = ctx.kind ?? 'crypto';
  const nowSec = ctx.nowSec ?? Math.floor(Date.now() / 1000);
  const decimals = ctx.decimals ?? 2;
  const news = ctx.news ?? UNKNOWN_NEWS;

  // 1 ── data validation → closed candles only
  const sanitized = sanitizeCandles(rawCandles, {
    timeframe: tf, continuous: kind === 'crypto', maxJump: ctx.maxJump ?? (kind === 'crypto' ? 0.5 : 0.08), nowSec,
  });
  let candles = dropFormingCandle(sanitized.candles, tf, nowSec);
  if (ctx.floorTime) candles = candles.filter(c => c.time >= ctx.floorTime!);
  const health = assessSeriesHealth({ ...sanitized, candles }, { minCandles: MIN_CANDLES, continuous: kind === 'crypto' });
  const dataNotes = [...health.reasons];
  if (sanitized.issues.length) dataNotes.push(`${sanitized.issues.length} data-quality issue(s) logged (${[...new Set(sanitized.issues.map(i => i.code))].join(', ')})`);

  if (health.level === 'unusable' || candles.length < MIN_CANDLES) {
    return unavailable(symbol, tf, candles, decimals, news, health.reasons.join('; ') || `Only ${candles.length} closed candles`);
  }

  const lastPrice = candles[candles.length - 1].close;

  // 2 ── structure, levels, liquidity (each from real candles)
  const structure = analyzeStructure(candles);
  const liquidity = detectLiquidity(candles, structure.swings);
  const sr = detectSupportResistance(candles, structure.swings);
  const zones = detectZones(candles, structure.swings);
  const volatility = analyzeVolatility(candles);
  const momentum = analyzeMomentum(candles, structure.swings);
  const indicators = computeIndicators(candles);
  const { trend, trendStrength } = determineTrend(candles, structure, indicators);

  // 3 ── patterns + candles (context-aware)
  const prevailing = structure.state === 'bullish' ? 'bullish' : structure.state === 'bearish' ? 'bearish' : 'neutral';
  const chartPatterns = enrichChartPatterns(detectChartPatterns(candles), candles, prevailing);
  const candlePatterns = detectCandlePatterns(candles, { swings: structure.swings, support: sr.support, resistance: sr.resistance, zones });

  // 4 ── breakouts / retests on the levels that matter
  const breakouts = detectBreakouts(candles, [...sr.support, ...sr.resistance]);

  // 5 ── multi-timeframe context
  let mtf: MtfContext | null = null;
  const cc = ctx.contextCandles;
  if (cc) {
    const wanted = getContextTimeframes(tf);
    const entry = buildTimeframeContext(candles, tf, 'entry', { nowSec, maxJump: ctx.maxJump });
    const mid = wanted.middle && cc.middle ? buildTimeframeContext(cc.middle, wanted.middle, 'middle', { nowSec, maxJump: ctx.maxJump }) : null;
    const high = wanted.higher && cc.higher ? buildTimeframeContext(cc.higher, wanted.higher, 'higher', { nowSec, maxJump: ctx.maxJump }) : null;
    if (entry) mtf = combineMtf(entry, mid, high);
  }

  // 6 ── decision (scenarios, risk, gates)
  const out = decide({
    candles, decimals, structure, trend, trendStrength,
    support: sr.support, resistance: sr.resistance, zones, liquidity,
    chartPatterns, candlePatterns, breakouts, momentum, indicators, volatility,
    mtf, news, dataLevel: health.level, dataReasons: health.reasons,
    feed: ctx.feed ?? 'n/a', kind,
  });

  return {
    symbol, timeframe, candleCount: candles.length, lastPrice,
    summary: buildSummary(candles, structure, chartPatterns, candlePatterns, trend),
    structure, trend, trendStrength,
    supportLevels: sr.support, resistanceLevels: sr.resistance,
    liquidity, zones, chartPatterns, candlePatterns, indicators,
    bullishScenario: out.bullishScenario, bearishScenario: out.bearishScenario,
    tradeSetup: out.tradeSetup,
    newsRisk: news.level, newsRiskDetail: news,
    decision: out.decision, decisionReason: out.decisionReason,
    decimals, asOf: candles[candles.length - 1].time, evidence: out.evidence, mtf,
    breakouts, momentum, volatility, dataNotes,
  };
}

function unavailable(symbol: string, tf: Timeframe, candles: Candle[], decimals: number, news: NewsRiskDetail, why: string): AnalysisResult {
  const evidence: EvidenceSummary = {
    state: 'insufficient', bullishPoints: 0, bearishPoints: 0, items: [],
    gates: [{ name: 'Data quality', passed: false, note: why }],
    explanation: 'Analysis was not run because the market data failed validation. Nothing has been inferred.',
  };
  return {
    symbol, timeframe: tf, candleCount: candles.length, lastPrice: candles.length ? candles[candles.length - 1].close : 0,
    summary: `DATA UNAVAILABLE — ${why}`,
    structure: { swings: [], labels: [], events: [], currentBias: 'neutral', state: 'sideways' },
    trend: 'sideways', trendStrength: 'weak', supportLevels: [], resistanceLevels: [],
    liquidity: { levels: [], equalHighs: [], equalLows: [], recentSweep: null },
    zones: [], chartPatterns: [], candlePatterns: [],
    indicators: emptyIndicators(),
    bullishScenario: 'Not evaluated — data unavailable.', bearishScenario: 'Not evaluated — data unavailable.',
    tradeSetup: null, newsRisk: news.level, newsRiskDetail: news,
    decision: 'NO TRADE', decisionReason: `DATA UNAVAILABLE — ${why}`,
    decimals, evidence, unavailableReason: why, dataNotes: [why],
  };
}

function emptyIndicators(): IndicatorSnapshot {
  return { ema20: null, ema50: null, ema100: null, ema200: null, rsi: null, macdLine: null, macdSignal: null, macdHist: null, atr: null, vwap: null };
}

// ── Indicator snapshot (last CLOSED candle) ─────────────────────

export function computeIndicators(candles: Candle[]): IndicatorSnapshot {
  const n = candles.length;
  const last = <T,>(arr: (T | null)[]): T | null => (arr.length ? arr[arr.length - 1] : null);
  const macdR = macd(candles, 12, 26, 9);
  const bb = bollinger(candles, 20, 2);
  const adxR = adx(candles, 14);
  const srsi = stochasticRsi(candles, 14, 14, 3, 3);
  const bu = last(bb.upper), bl = last(bb.lower), bm = last(bb.mid);

  // Volume ratio only if the feed carries REAL volume.
  let volumeRatio: number | null = null;
  const vols = candles.slice(-21, -1).map(c => c.volume ?? 0);
  const lv = candles[n - 1].volume;
  if (lv !== undefined && vols.filter(v => v > 0).length >= 15) {
    const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
    volumeRatio = avg > 0 ? lv / avg : null;
  }

  return {
    ema20: last(ema(candles, 20)),
    ema50: last(ema(candles, 50)),
    ema100: last(ema(candles, 100)),
    ema200: n >= 200 ? last(ema(candles, 200)) : null,
    rsi: last(rsi(candles, 14)),
    macdLine: last(macdR.macdLine), macdSignal: last(macdR.signalLine), macdHist: last(macdR.histogram),
    atr: last(atr(candles, 14)),
    vwap: last(vwap(candles)),
    adx: last(adxR.adx), plusDI: last(adxR.plusDI), minusDI: last(adxR.minusDI),
    bbUpper: bu, bbMid: bm, bbLower: bl,
    bbWidthPct: bu !== null && bl !== null && bm ? ((bu - bl) / bm) * 100 : null,
    stochRsiK: last(srsi.k), stochRsiD: last(srsi.d),
    volumeRatio,
  };
}

// ── Trend determination ─────────────────────────────────────────

function determineTrend(
  candles: Candle[],
  structure: { currentBias: string; state?: string },
  ind: IndicatorSnapshot,
): { trend: AnalysisResult['trend']; trendStrength: 'strong' | 'moderate' | 'weak' } {
  const lastClose = candles[candles.length - 1].close;
  let bull = 0, bear = 0, total = 0;
  const vote = (cond: boolean | null) => { if (cond === null) return; total++; if (cond) bull++; else bear++; };

  if (ind.ema20 !== null && ind.ema50 !== null) vote(ind.ema20 > ind.ema50);
  if (ind.ema50 !== null && ind.ema100 !== null) vote(ind.ema50 > ind.ema100);
  if (ind.ema100 !== null && ind.ema200 !== null) vote(ind.ema100 > ind.ema200);
  if (ind.ema50 !== null) vote(lastClose > ind.ema50);
  if (structure.currentBias === 'bullish') vote(true); else if (structure.currentBias === 'bearish') vote(false);
  if (ind.macdLine !== null && ind.macdSignal !== null) vote(ind.macdLine > ind.macdSignal);

  const ratio = total ? bull / total : 0.5;
  let trend: AnalysisResult['trend'] = ratio > 0.6 ? 'bullish' : ratio < 0.4 ? 'bearish' : 'sideways';
  if (structure.state === 'transition') trend = 'transition';
  const trendStrength = ratio > 0.8 || ratio < 0.2 ? 'strong' : ratio > 0.7 || ratio < 0.3 ? 'moderate' : 'weak';
  return { trend, trendStrength };
}

function buildSummary(
  candles: Candle[],
  structure: { currentBias: string; state?: string; events: { type: string; direction: string }[] },
  patterns: { name: string; confirmed: boolean }[],
  candlePatterns: { name: string }[],
  trend: string,
): string {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const changePct = ((last.close - prev.close) / prev.close) * 100;
  const parts = [
    `Last closed candle ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(2)}%`,
    `Trend: ${trend}`,
    `Structure: ${structure.state ?? structure.currentBias}`,
  ];
  if (patterns.length) parts.push(`Pattern: ${patterns[0].name} (${patterns[0].confirmed ? 'confirmed' : 'forming'})`);
  const ev = structure.events[structure.events.length - 1];
  if (ev) parts.push(`Last structure event: ${ev.type} ${ev.direction}`);
  if (candlePatterns.length) parts.push(`Latest candle signal: ${candlePatterns[0].name}`);
  return parts.join('. ') + '.';
}

// ── Chart Overlay Generator ─────────────────────────────────────

export function generateOverlay(result: AnalysisResult): ChartOverlay {
  const lines: ChartOverlay['lines'] = [];
  const markers: ChartOverlay['markers'] = [];
  const zones: ChartOverlay['zones'] = [];
  if (result.unavailableReason) return { lines, markers, zones };

  for (const label of result.structure.labels.slice(-8)) {
    const isHigh = label.label === 'HH' || label.label === 'LH';
    markers.push({
      time: label.time, position: isHigh ? 'aboveBar' : 'belowBar',
      color: label.label === 'HH' || label.label === 'HL' ? '#22c55e' : '#ef4444',
      shape: isHigh ? 'arrowDown' : 'arrowUp', text: label.label,
    });
  }
  for (const ev of result.structure.events.slice(-4)) {
    markers.push({ time: ev.time, position: 'inBar', color: ev.direction === 'bullish' ? '#22c55e' : '#ef4444', shape: 'circle', text: ev.type });
  }

  for (const s of result.supportLevels.slice(0, 2)) lines.push({ price: s.price, color: 'rgba(34,197,94,0.55)', lineStyle: 'dashed', lineWidth: 1, title: 'Support' });
  for (const r of result.resistanceLevels.slice(0, 2)) lines.push({ price: r.price, color: 'rgba(239,68,68,0.55)', lineStyle: 'dashed', lineWidth: 1, title: 'Resistance' });

  // Zones are drawn as dotted top/bottom edges (the chart renders price lines).
  for (const z of result.zones.filter(z => !z.invalidated).slice(0, 2)) {
    const col = z.type === 'supply' ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)';
    const name = z.type === 'supply' ? 'Supply' : 'Demand';
    lines.push({ price: z.top, color: col, lineStyle: 'dotted', lineWidth: 1, title: `${name} top` });
    lines.push({ price: z.bottom, color: col, lineStyle: 'dotted', lineWidth: 1, title: `${name} bottom` });
    zones.push({ time: z.time, top: z.top, bottom: z.bottom, color: col });
  }

  const t = result.tradeSetup;
  if (t) {
    lines.push({ price: t.stopLoss, color: '#ef4444', lineStyle: 'dotted', lineWidth: 2, title: 'SL' });
    lines.push({ price: t.tp1, color: '#22c55e', lineStyle: 'dotted', lineWidth: 1, title: 'TP1' });
    lines.push({ price: t.tp2, color: '#22c55e', lineStyle: 'dotted', lineWidth: 1, title: 'TP2' });
    lines.push({ price: t.tp3, color: '#22c55e', lineStyle: 'dotted', lineWidth: 1, title: 'TP3' });
    lines.push({ price: t.invalidation, color: '#f59e0b', lineStyle: 'dashed', lineWidth: 1, title: 'Invalidation' });
  }
  return { lines, markers, zones };
}

export { currentAtr };
