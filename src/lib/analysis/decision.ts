import type { Candle } from '@/types/trading';
import type {
  BreakoutEvent, CandlePattern, ChartPattern, EvidenceItem, EvidenceState, EvidenceSummary, FinalDecision,
  GateResult, IndicatorSnapshot, LiquidityResult, MarketStructureResult, MomentumResult, MtfContext,
  NewsRiskDetail, SRLevel, TradeSetup, VolatilityResult, Zone,
} from './types';
import { buildTradePlan } from './tradePlan';

// ── Decision engine ─────────────────────────────────────────────
// REAL DATA → MTF → STRUCTURE → TREND → S/R → S/D → LIQUIDITY → PATTERN →
// CANDLE → BREAKOUT/RETEST → MOMENTUM → INDICATORS → VOLATILITY → NEWS →
// BULL scenario → BEAR scenario → RISK → DECISION
//
// Evidence is scored for each side; independent HARD GATES must also pass for
// BUY/SELL. When evidence conflicts or is thin the answer is WAIT / NO TRADE.
// Indicators are context only: RSI > 70 is never an automatic SELL, RSI < 30 never
// an automatic BUY. No pattern, news item or indicator can create a trade alone.

export type FeedFreshness = 'fresh' | 'stale' | 'dead' | 'none' | 'n/a';

export interface DecisionInput {
  candles: Candle[];                      // CLOSED candles only
  decimals: number;
  structure: MarketStructureResult;
  trend: 'bullish' | 'bearish' | 'sideways' | 'transition';
  trendStrength: 'strong' | 'moderate' | 'weak';
  support: SRLevel[];
  resistance: SRLevel[];
  zones: Zone[];
  liquidity: LiquidityResult;
  chartPatterns: ChartPattern[];
  candlePatterns: CandlePattern[];
  breakouts: BreakoutEvent[];
  momentum: MomentumResult;
  indicators: IndicatorSnapshot;
  volatility: VolatilityResult;
  mtf: MtfContext | null;
  news: NewsRiskDetail;
  dataLevel: 'ok' | 'degraded' | 'unusable';
  dataReasons: string[];
  feed: FeedFreshness;
  kind: 'crypto' | 'fx' | 'metal';
}

export interface DecisionOutput {
  decision: FinalDecision;
  decisionReason: string;
  evidence: EvidenceSummary;
  tradeSetup: TradeSetup | null;
  bullishScenario: string;
  bearishScenario: string;
}

const NET_ACTION = 4.5;     // minimum net evidence points for BUY/SELL
const NET_BIAS = 2;         // below this → no edge

export function decide(inp: DecisionInput): DecisionOutput {
  const { candles, decimals: d } = inp;
  const n = candles.length;
  const price = candles[n - 1].close;
  const atr = inp.volatility.atr ?? 0;
  const items: EvidenceItem[] = [];
  const push = (factor: string, stance: EvidenceItem['stance'], weight: number, note: string) =>
    items.push({ factor, stance, weight: stance === 'neutral' ? 0 : weight, note });
  const f = (v: number) => v.toFixed(d);

  // 1 ── Multi-timeframe
  if (inp.mtf && inp.mtf.alignment !== 'unavailable') {
    const al = inp.mtf.alignment;
    if (al === 'aligned-bullish') push('Multi-timeframe', 'bullish', 2, 'Higher/middle/entry timeframes agree bullish');
    else if (al === 'aligned-bearish') push('Multi-timeframe', 'bearish', 2, 'Higher/middle/entry timeframes agree bearish');
    else if (al === 'conflicting') push('Multi-timeframe', 'neutral', 0, 'Higher timeframe conflicts with the entry timeframe');
    else push('Multi-timeframe', 'neutral', 0, 'Partial alignment — higher timeframe has no clear direction');
  } else push('Multi-timeframe', 'neutral', 0, 'Higher-timeframe context unavailable');

  // 2 ── Structure
  const st = inp.structure;
  const lastEv = st.events[st.events.length - 1];
  if (st.state === 'bullish') push('Market structure', 'bullish', 2, 'HH/HL sequence; last break was bullish');
  else if (st.state === 'bearish') push('Market structure', 'bearish', 2, 'LH/LL sequence; last break was bearish');
  else if (st.state === 'transition' && lastEv) push('Market structure', lastEv.direction, 1, `Transition: ${lastEv.type} ${lastEv.direction} (not yet confirmed by a follow-through BOS)`);
  else push('Market structure', 'neutral', 0, 'Sideways — no dominant structure');

  // 3 ── Trend & indicators (EMA stack + ADX); RSI etc. are context notes only
  const adx = inp.indicators.adx ?? null;
  const trending = adx === null ? true : adx >= 20;
  if (inp.trend === 'bullish' || inp.trend === 'bearish') {
    push('Trend (EMA stack)', inp.trend, trending ? 1.5 : 0.75,
      `EMA/price alignment ${inp.trend}${adx !== null ? `, ADX ${adx.toFixed(1)} (${trending ? 'trending' : 'weak trend / ranging'})` : ''}`);
  } else push('Trend (EMA stack)', 'neutral', 0, `Trend ${inp.trend}`);

  // 4 ── Support / resistance location
  const nearS = inp.support[0], nearR = inp.resistance[0];
  if (atr > 0 && nearS && price - nearS.price <= 0.75 * atr && (nearS.rejections ?? 0) + (nearS.retest ? 1 : 0) >= 1) {
    push('Support / resistance', 'bullish', 1, `Price at support ${f(nearS.price)} (${nearS.tested} tests, ${nearS.rejections ?? 0} rejections)`);
  } else if (atr > 0 && nearR && nearR.price - price <= 0.75 * atr && (nearR.rejections ?? 0) + (nearR.retest ? 1 : 0) >= 1) {
    push('Support / resistance', 'bearish', 1, `Price at resistance ${f(nearR.price)} (${nearR.tested} tests, ${nearR.rejections ?? 0} rejections)`);
  } else push('Support / resistance', 'neutral', 0, `Nearest support ${nearS ? f(nearS.price) : '—'} / resistance ${nearR ? f(nearR.price) : '—'}; price not at a tested level`);

  // 5 ── Supply / demand
  const zIn = inp.zones.find(z => !z.invalidated && price <= z.top + 0.3 * atr && price >= z.bottom - 0.3 * atr);
  if (zIn) {
    const w = zIn.strength === 'strong' ? 1 : zIn.strength === 'moderate' ? 0.75 : 0.4;
    push('Supply / demand', zIn.type === 'demand' ? 'bullish' : 'bearish', w,
      `Price in/at ${zIn.strength} ${zIn.type} zone ${f(zIn.bottom)}–${f(zIn.top)} (${zIn.retests ?? 0} retests; invalid beyond ${f(zIn.invalidationPrice ?? 0)})`);
  } else push('Supply / demand', 'neutral', 0, 'Price is not in a valid supply/demand zone');

  // 6 ── Liquidity
  const sw = inp.liquidity.recentSweep;
  if (sw) {
    const bullish = sw.type === 'sell-side';
    const w = sw.reaction === 'confirmed' ? 1.5 : 0.75;
    push('Liquidity', bullish ? 'bullish' : 'bearish', w,
      `${sw.type} liquidity at ${f(sw.price)} swept${sw.equal ? ' (equal levels)' : ''}; reaction ${sw.reaction}`);
  } else push('Liquidity', 'neutral', 0, 'No recent liquidity sweep with a reaction');

  // 7 ── Chart pattern (needs independent confirmation — enforced by gate)
  const pat = inp.chartPatterns.find(p => p.confirmed && p.direction !== 'neutral');
  if (pat) {
    const w = pat.context === 'counter-trend' ? 0.5 : 1;
    push('Chart pattern', pat.direction as 'bullish' | 'bearish', w, `${pat.name} confirmed (${pat.context ?? 'neutral'}); invalid beyond ${pat.invalidation !== undefined ? f(pat.invalidation) : 'n/a'}`);
  } else {
    const forming = inp.chartPatterns[0];
    push('Chart pattern', 'neutral', 0, forming ? `${forming.name} forming — not confirmed` : 'No objectively supported pattern');
  }

  // 8 ── Candle confirmation
  const recentCandle = inp.candlePatterns.find(c => c.index >= n - 3 && c.atKeyLevel && c.direction !== 'neutral');
  if (recentCandle) push('Candle confirmation', recentCandle.direction as 'bullish' | 'bearish', 1, `${recentCandle.name} at a key level`);
  else push('Candle confirmation', 'neutral', 0, 'No reversal/continuation candle at a key level in the last 3 bars');

  // 9 ── Breakout / retest
  const bo = inp.breakouts.find(b => b.index >= n - 15 && b.type !== 'breakout');
  if (bo) {
    if (bo.type === 'confirmed-breakout' || bo.type === 'retest-held') push('Breakout / retest', bo.direction, bo.type === 'retest-held' ? 1.5 : 1, `${bo.type} ${bo.direction} through ${f(bo.level)}: ${bo.note}`);
    else if (bo.type === 'false-breakout') push('Breakout / retest', bo.direction === 'bullish' ? 'bearish' : 'bullish', 1, `False ${bo.direction} breakout at ${f(bo.level)} (trapped breakout traders)`);
    else push('Breakout / retest', bo.direction === 'bullish' ? 'bearish' : 'bullish', 1, `Failed retest of ${f(bo.level)}`);
  } else push('Breakout / retest', 'neutral', 0, 'No confirmed breakout, false breakout or retest in the last 15 bars');

  // 10 ── Momentum (+ divergence)
  const m = inp.momentum;
  const div = m.divergences[0];
  if (div) push('Momentum divergence', div.type, 1, `${div.type} ${div.source} divergence`);
  if (m.direction !== 'neutral' && m.state === 'strengthening') push('Momentum', m.direction, 1, `Momentum ${m.direction} and strengthening`);
  else push('Momentum', 'neutral', 0, m.state === 'weakening' ? 'Momentum weakening — caution' : `Momentum ${m.direction}, no strengthening`);

  // 11 ── Indicator context (never a signal)
  const ctxNotes: string[] = [];
  const rsi = inp.indicators.rsi;
  if (rsi !== null) {
    if (rsi >= 70) ctxNotes.push(`RSI ${rsi.toFixed(1)} is extended (>70): late long entries carry mean-reversion risk; it is NOT a sell signal`);
    else if (rsi <= 30) ctxNotes.push(`RSI ${rsi.toFixed(1)} is depressed (<30): late short entries carry bounce risk; it is NOT a buy signal`);
    else ctxNotes.push(`RSI ${rsi.toFixed(1)}`);
  }
  if (inp.indicators.bbWidthPct != null) ctxNotes.push(`Bollinger width ${inp.indicators.bbWidthPct.toFixed(2)}%`);
  if (inp.indicators.volumeRatio != null) ctxNotes.push(`volume ${inp.indicators.volumeRatio.toFixed(2)}× 20-bar average`);
  push('Indicator context', 'neutral', 0, ctxNotes.join('; ') || 'No indicator context');

  // 12 ── Volatility
  push('Volatility', 'neutral', 0, `ATR regime ${inp.volatility.regime}, ${inp.volatility.trend}${inp.volatility.notes.length ? '; ' + inp.volatility.notes.join('; ') : ''}`);

  // 13 ── News
  push('News / fundamentals', 'neutral', 0,
    inp.news.level === 'unknown' ? 'NEWS DATA UNAVAILABLE' : `News risk ${inp.news.level.toUpperCase()}${inp.news.phase ? ` (${inp.news.phase})` : ''}; ${inp.news.drivers[0] ?? ''}`);

  const bull = sum(items, 'bullish'), bear = sum(items, 'bearish');
  const net = bull - bear;
  const dir: 'long' | 'short' = net >= 0 ? 'long' : 'short';
  const want = dir === 'long' ? 'bullish' : 'bearish';
  const hi = Math.max(bull, bear), lo = Math.min(bull, bear);
  const conflictRatio = hi > 0 ? lo / hi : 0;

  // ── Hard gates (evaluated for the candidate direction) ──
  const gates: GateResult[] = [];
  const gate = (name: string, passed: boolean, note: string) => gates.push({ name, passed, note });

  gate('Data quality', inp.dataLevel !== 'unusable' && n >= 50,
    inp.dataLevel === 'unusable' ? `Data unusable: ${inp.dataReasons.join('; ')}` : n < 50 ? `Only ${n} closed candles (need 50)` : inp.dataLevel === 'degraded' ? `Degraded: ${inp.dataReasons.join('; ')}` : 'Validated OHLC');
  gate('Live feed freshness', inp.feed === 'n/a' || inp.feed === 'fresh', inp.feed === 'n/a' ? 'Not applicable' : inp.feed === 'fresh' ? 'Prices are streaming' : `Feed is ${inp.feed} — price may not reflect the market`);
  gate('News risk', inp.news.level !== 'high', inp.news.level === 'high' ? `HIGH NEWS RISK${inp.news.phase ? ` (${inp.news.phase})` : ''}: ${inp.news.drivers[0] ?? ''}` : `News risk ${inp.news.level}`);
  gate('Volatility', inp.volatility.regime !== 'extreme' && (inp.volatility.lastBarAtrMultiple ?? 0) < 3.5,
    inp.volatility.regime === 'extreme' ? 'Extreme ATR regime' : (inp.volatility.lastBarAtrMultiple ?? 0) >= 3.5 ? 'Abnormal last-bar range' : `Regime ${inp.volatility.regime}`);

  const htfConflict = inp.mtf?.alignment === 'conflicting';
  const lead = inp.mtf?.higher ?? inp.mtf?.middle ?? null;
  const leadOpposes = !!lead && ((want === 'bullish' && lead.bias === 'bearish') || (want === 'bearish' && lead.bias === 'bullish'));
  gate('Higher-timeframe context', !htfConflict && !leadOpposes,
    htfConflict || leadOpposes ? 'Higher timeframe opposes this direction' : inp.mtf && inp.mtf.alignment !== 'unavailable' ? 'No higher-timeframe conflict' : 'Higher timeframe unavailable (not a conflict, but unconfirmed)');

  const structAligned = st.state === want || (st.state === 'transition' && lastEv?.direction === want) ||
    (sw?.reaction === 'confirmed' && (sw.type === 'sell-side') === (want === 'bullish'));
  gate('Structure agrees', !!structAligned, structAligned ? 'Structure / confirmed sweep supports the direction' : `Structure is ${st.state}`);

  const triggers: string[] = [];
  if (pat && pat.direction === want) triggers.push('pattern');
  if (recentCandle && recentCandle.direction === want) triggers.push('candle');
  if (sw && sw.reaction === 'confirmed' && (sw.type === 'sell-side') === (want === 'bullish')) triggers.push('liquidity sweep');
  if (bo && ((bo.direction === want && (bo.type === 'confirmed-breakout' || bo.type === 'retest-held')) ||
    ((bo.type === 'false-breakout' || bo.type === 'failed-retest') && bo.direction !== want))) triggers.push('breakout/retest');
  if (lastEv && lastEv.direction === want && lastEv.type !== 'BOS' && lastEv.index >= n - 10) triggers.push('CHOCH/MSS');
  const independent = triggers.filter(t => t !== 'pattern');
  gate('Independent trigger', independent.length >= 1,
    independent.length ? `Triggers: ${triggers.join(', ')}` : triggers.includes('pattern') ? 'A pattern alone never creates a trade — needs candle, sweep, breakout/retest or CHOCH confirmation' : 'No entry trigger present');

  // ── Trade plan only if a direction has real evidence ──
  let setup: TradeSetup | null = null;
  let planReason = 'No directional edge';
  if (Math.abs(net) >= NET_BIAS && atr > 0) {
    const plan = buildTradePlan({
      direction: dir, candles, atr, structure: st, support: inp.support, resistance: inp.resistance,
      liquidity: inp.liquidity, zones: inp.zones, decimals: d,
    });
    setup = plan.setup; planReason = plan.reason;
  }
  gate('Valid risk plan', !!setup, setup ? `Stop ${f(setup.stopLoss)} (${setup.stopAtrMultiple?.toFixed(1)}× ATR), R:R to TP2 ${setup.rrTp2?.toFixed(2)}` : planReason);

  const failed = gates.filter(g => !g.passed);
  const dataBad = !gates[0].passed;

  // ── Decision ──
  let decision: FinalDecision;
  let reason: string;
  let state: EvidenceState;

  if (dataBad) {
    decision = 'NO TRADE'; state = 'insufficient';
    reason = `DATA UNAVAILABLE / INSUFFICIENT — ${gates[0].note}.`;
  } else if (hi >= 3 && conflictRatio >= 0.5) {
    decision = 'NO TRADE'; state = 'conflicting';
    reason = `Conflicting evidence: ${bull.toFixed(1)} bullish vs ${bear.toFixed(1)} bearish points. Standing aside is preferred over forcing a side.`;
  } else if (Math.abs(net) < NET_BIAS) {
    decision = 'NO TRADE'; state = 'insufficient';
    reason = `Insufficient evidence (net ${net.toFixed(1)} points). No edge identified.`;
  } else if (Math.abs(net) < NET_ACTION) {
    decision = 'WAIT'; state = 'weak';
    reason = `${want} bias is building (net ${Math.abs(net).toFixed(1)} of ${NET_ACTION} points needed) but confirmation is incomplete.`;
  } else if (failed.length) {
    decision = 'WAIT'; state = Math.abs(net) >= 6 ? 'moderate' : 'weak';
    reason = `${want} evidence is strong enough (net ${Math.abs(net).toFixed(1)}) but ${failed.length} safety gate(s) failed: ${failed.map(g => `${g.name} — ${g.note}`).join(' | ')}`;
  } else {
    decision = dir === 'long' ? 'BUY' : 'SELL';
    const newsKnown = inp.news.level !== 'unknown' && !(inp.kind !== 'crypto' && inp.news.coverage === 'headlines-only');
    const htfOk = inp.mtf?.alignment === (dir === 'long' ? 'aligned-bullish' : 'aligned-bearish');
    state = Math.abs(net) >= 7 && newsKnown && htfOk && inp.dataLevel === 'ok' ? 'strong' : 'moderate';
    reason = `${want} confluence: ${Math.abs(net).toFixed(1)} net points, all safety gates passed (${triggers.join(', ')}).`;
  }

  const explanation =
    `${bull.toFixed(1)} bullish vs ${bear.toFixed(1)} bearish evidence points. ` +
    (failed.length ? `Failed gates: ${failed.map(g => g.name).join(', ')}. ` : 'All gates passed. ') +
    (inp.news.level === 'unknown' ? 'News data unavailable, so evidence is capped below "strong". ' : '') +
    'This describes the current chart evidence only; it is not a prediction or a guarantee.';

  return {
    decision,
    decisionReason: reason,
    evidence: { state, bullishPoints: bull, bearishPoints: bear, items, gates, explanation },
    tradeSetup: decision === 'BUY' || decision === 'SELL' ? setup : null,
    bullishScenario: scenario('bullish', items, inp, f),
    bearishScenario: scenario('bearish', items, inp, f),
  };
}

function sum(items: EvidenceItem[], s: 'bullish' | 'bearish'): number {
  return items.filter(i => i.stance === s).reduce((a, b) => a + b.weight, 0);
}

function scenario(side: 'bullish' | 'bearish', items: EvidenceItem[], inp: DecisionInput, f: (v: number) => string): string {
  const supporting = items.filter(i => i.stance === side).map(i => i.factor.toLowerCase());
  const bull = side === 'bullish';
  const trigger = bull ? inp.structure.activeHigh : inp.structure.activeLow;
  const inval = bull ? inp.structure.swings.filter(s => s.type === 'low').slice(-1)[0] : inp.structure.swings.filter(s => s.type === 'high').slice(-1)[0];
  const nearTarget = bull ? inp.resistance[0] : inp.support[0];
  const parts: string[] = [];
  parts.push(supporting.length ? `Supported by: ${supporting.join(', ')}.` : `No current evidence supports a ${side} move.`);
  if (trigger) parts.push(`A candle CLOSE ${bull ? 'above' : 'below'} ${f(trigger.price)} would ${bull ? 'break the last swing high' : 'break the last swing low'} and strengthen this case.`);
  if (nearTarget) parts.push(`First level in the path: ${f(nearTarget.price)}.`);
  if (inval) parts.push(`The scenario weakens if price closes ${bull ? 'below' : 'above'} ${f(inval.price)}.`);
  return parts.join(' ');
}
