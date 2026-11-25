import type {
  AizenDecision, AizenSettings, AizenState, ExecutionAssumptions, InstrumentSpec, PriceMap, RiskCheck, RiskSettings, RiskVerdict,
} from './types';
import { LIVE_TRADING_AVAILABLE } from './types';
import { floorToStep, getSpec, notionalUsd, quoteToUsd } from './instruments';
import { equityOf, openNotional, todayStats } from './accounting';
import { ASSET_CONFIGS } from '@/types/trading';

// ── Conservative defaults ───────────────────────────────────────
export const DEFAULT_RISK: RiskSettings = {
  startingEquity: 10_000,
  riskPerTradePct: 0.5,
  maxDailyLossPct: 2,
  maxDrawdownPct: 10,
  maxOpenPositions: 3,
  maxTotalExposurePct: 200,
  maxLeverage: 2,
  maxConsecutiveLosses: 3,
  maxTradesPerDay: 5,
  minRewardToRisk: 1.5,
  maxEntryDriftAtr: 0.5,
  maxSpreadBps: 10,
  requireNewsCoverage: true,
};

/** Ceilings the UI / stored settings can never exceed ("hard risk limits must always apply"). */
export const HARD_LIMITS = {
  riskPerTradePct: 2, maxDailyLossPct: 10, maxDrawdownPct: 30, maxOpenPositions: 10, maxTotalExposurePct: 500,
  maxLeverage: 10, maxConsecutiveLosses: 10, maxTradesPerDay: 50, minRewardToRiskFloor: 1,
} as const;

export const DEFAULT_EXECUTION: ExecutionAssumptions = { scaleOut: [0.5, 0.3, 0.2], moveStopToBreakevenAfterTp1: true };

export const DEFAULT_SETTINGS: AizenSettings = {
  agentOn: false,
  mode: 'paper',
  timeframe: '1H',
  markets: { crypto: true, forex: false, gold: false },
  assets: ['BTC', 'ETH'],
  risk: DEFAULT_RISK,
  execution: DEFAULT_EXECUTION,
  emergencyStopped: false,
  emergencyPolicy: 'freeze',
};

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Coerce arbitrary (stored / user-edited) risk settings into the allowed envelope. */
export function sanitizeRisk(r: Partial<RiskSettings> | undefined): RiskSettings {
  const d = DEFAULT_RISK;
  return {
    startingEquity: clamp(num(r?.startingEquity, d.startingEquity), 100, 1e9),
    riskPerTradePct: clamp(num(r?.riskPerTradePct, d.riskPerTradePct), 0.01, HARD_LIMITS.riskPerTradePct),
    maxDailyLossPct: clamp(num(r?.maxDailyLossPct, d.maxDailyLossPct), 0.1, HARD_LIMITS.maxDailyLossPct),
    maxDrawdownPct: clamp(num(r?.maxDrawdownPct, d.maxDrawdownPct), 1, HARD_LIMITS.maxDrawdownPct),
    maxOpenPositions: Math.round(clamp(num(r?.maxOpenPositions, d.maxOpenPositions), 1, HARD_LIMITS.maxOpenPositions)),
    maxTotalExposurePct: clamp(num(r?.maxTotalExposurePct, d.maxTotalExposurePct), 10, HARD_LIMITS.maxTotalExposurePct),
    maxLeverage: clamp(num(r?.maxLeverage, d.maxLeverage), 1, HARD_LIMITS.maxLeverage),
    maxConsecutiveLosses: Math.round(clamp(num(r?.maxConsecutiveLosses, d.maxConsecutiveLosses), 1, HARD_LIMITS.maxConsecutiveLosses)),
    maxTradesPerDay: Math.round(clamp(num(r?.maxTradesPerDay, d.maxTradesPerDay), 1, HARD_LIMITS.maxTradesPerDay)),
    minRewardToRisk: clamp(num(r?.minRewardToRisk, d.minRewardToRisk), HARD_LIMITS.minRewardToRiskFloor, 10),
    maxEntryDriftAtr: clamp(num(r?.maxEntryDriftAtr, d.maxEntryDriftAtr), 0.05, 3),
    maxSpreadBps: clamp(num(r?.maxSpreadBps, d.maxSpreadBps), 0.1, 200),
    requireNewsCoverage: typeof r?.requireNewsCoverage === 'boolean' ? r.requireNewsCoverage : d.requireNewsCoverage,
  };
}

export function sanitizeExecution(e: Partial<ExecutionAssumptions> | undefined): ExecutionAssumptions {
  const s = e?.scaleOut;
  const ok = Array.isArray(s) && s.length === 3 && s.every(x => Number.isFinite(x) && x >= 0) && Math.abs(s[0] + s[1] + s[2] - 1) < 1e-6;
  return { scaleOut: ok ? [s[0], s[1], s[2]] : DEFAULT_EXECUTION.scaleOut, moveStopToBreakevenAfterTp1: typeof e?.moveStopToBreakevenAfterTp1 === 'boolean' ? e.moveStopToBreakevenAfterTp1 : true };
}

// ── Position sizing ─────────────────────────────────────────────
export interface SizeInput {
  equity: number;
  riskPct: number;
  entry: number;
  stop: number;
  spec: InstrumentSpec;
  maxLeverage: number;
  /** Extra notional (USD) still allowed by the total-exposure cap. */
  exposureHeadroomUsd: number;
}
export interface SizeResult { qty: number; riskUsd: number; notionalUsd: number; leverage: number; note: string | null }

/**
 * Fixed-fractional sizing: risk = equity × riskPct, qty = risk ÷ stop distance.
 * Sized from CURRENT equity, so a losing streak can only make the next position SMALLER — there is
 * no code path that scales size up to recover losses.
 */
export function sizePosition(i: SizeInput): SizeResult {
  const zero: SizeResult = { qty: 0, riskUsd: 0, notionalUsd: 0, leverage: 0, note: null };
  const dist = Math.abs(i.entry - i.stop);
  if (!(i.equity > 0) || !(dist > 0) || !(i.entry > 0)) return { ...zero, note: 'Cannot size: equity, entry or stop distance invalid' };
  const perUnitRisk = dist * quoteToUsd(i.spec, i.entry);
  let qty = (i.equity * i.riskPct / 100) / perUnitRisk;
  let note: string | null = null;
  const maxNotional = Math.max(0, Math.min(i.equity * i.maxLeverage, i.exposureHeadroomUsd));
  const wanted = notionalUsd(i.spec, qty, i.entry);
  if (wanted > maxNotional) {
    qty = wanted > 0 ? qty * (maxNotional / wanted) : 0;
    note = `Size reduced to respect leverage/exposure cap (wanted $${wanted.toFixed(0)}, allowed $${maxNotional.toFixed(0)})`;
  }
  qty = floorToStep(qty, i.spec.qtyStep);
  const notional = notionalUsd(i.spec, qty, i.entry);
  if (qty < i.spec.qtyStep || notional < i.spec.minNotionalUsd) return { ...zero, note: note ?? `Position below minimum size ($${i.spec.minNotionalUsd})` };
  return { qty, riskUsd: qty * perUnitRisk, notionalUsd: notional, leverage: notional / i.equity, note };
}

// ── Risk gate — Aizen can never bypass this ─────────────────────
export interface RiskContext {
  nowSec: number;
  prices: PriceMap;
  /** Latest real price for the asset (used for the expected fill). null ⇒ cannot execute. */
  livePrice: number | null;
  /** Real bid/ask spread in bps if a quote feed exists; null ⇒ assumed cost from InstrumentSpec is used. */
  spreadBps: number | null;
  /** Freshness measured NOW (overrides the value recorded when the decision was created, e.g. at approval time). */
  feed?: 'fresh' | 'stale';
}

export function evaluateRisk(state: AizenState, d: AizenDecision, ctx: RiskContext): RiskVerdict {
  const s = state.settings, r = s.risk;
  const checks: RiskCheck[] = [];
  const add = (name: string, passed: boolean, note: string) => checks.push({ name, passed, note });
  const none = (): RiskVerdict => ({ approved: false, checks, qty: 0, riskUsd: 0, notionalUsd: 0, leverage: 0, sizeNote: null });

  add('Emergency stop', !s.emergencyStopped, s.emergencyStopped ? 'Emergency STOP is active — no new orders' : 'Not active');
  add('Execution mode', s.mode !== 'live' || LIVE_TRADING_AVAILABLE, s.mode === 'live' && !LIVE_TRADING_AVAILABLE ? 'Live trading is not available (no broker connector)' : `Mode: ${s.mode}`);
  const cfg = ASSET_CONFIGS.find(a => a.id === d.assetId);
  const enabled = !!cfg && s.markets[d.category] && s.assets.includes(d.assetId);
  add('Market enabled', enabled, enabled ? `${d.symbol} enabled` : `${d.symbol} is not enabled for Aizen`);

  const levels = [d.entry, d.stopLoss, d.tp1, d.tp2, d.tp3, d.atr];
  const complete = (d.decision === 'LONG' || d.decision === 'SHORT') && levels.every(v => typeof v === 'number' && Number.isFinite(v));
  add('Valid decision', complete, complete ? `${d.decision} with complete plan` : `Decision is ${d.decision} or the plan is incomplete`);
  const feed = ctx.feed ?? d.feed;
  add('Market data fresh', feed === 'fresh', feed === 'fresh' ? 'Feed fresh' : 'Market data is stale — rejected');
  const newsOk = !r.requireNewsCoverage || d.newsCoverage !== 'none';
  add('News coverage', newsOk, newsOk ? `Coverage: ${d.newsCoverage}` : 'No news/calendar data — refusing to trade blind');

  if (!complete) return { ...none(), checks };

  const long = d.decision === 'LONG';
  const spec = getSpec(d.assetId);
  const live = ctx.livePrice;
  add('Live price', live !== null && Number.isFinite(live) && live > 0, live ? `Last price ${live}` : 'No live price available');
  if (!(live && live > 0)) return none();

  const slip = spec.slippageBps / 1e4;
  const fill = long ? live * (1 + slip) : live * (1 - slip);
  const stop = d.stopLoss!, tp1 = d.tp1!, tp2 = d.tp2!, tp3 = d.tp3!, atr = d.atr!;
  const ordered = long ? stop < fill && fill < tp1 && tp1 < tp2 && tp2 < tp3 : stop > fill && fill > tp1 && tp1 > tp2 && tp2 > tp3;
  add('Levels valid at fill', ordered, ordered ? 'Stop / entry / targets correctly ordered at expected fill' : 'Price has already moved through the plan levels');

  const rr = Math.abs(tp2 - fill) / Math.abs(fill - stop);
  add('Reward:risk', ordered && rr >= r.minRewardToRisk, ordered ? `R:R to TP2 ${rr.toFixed(2)} (min ${r.minRewardToRisk})` : 'n/a');

  const drift = Math.abs(live - d.entry!) / atr;
  add('Entry drift', drift <= r.maxEntryDriftAtr, `Price is ${drift.toFixed(2)} ATR from the planned entry (max ${r.maxEntryDriftAtr})`);

  const spreadBps = ctx.spreadBps ?? spec.assumedSpreadBps;
  add('Spread', spreadBps <= r.maxSpreadBps, `${spreadBps} bps ${ctx.spreadBps === null ? '(ASSUMED — no bid/ask feed)' : '(measured)'}, max ${r.maxSpreadBps}`);

  const equity = equityOf(state, ctx.prices);
  const today = todayStats(state, ctx.nowSec);
  const dayStartEquity = state.account.balance - today.realizedToday;
  const lossLimit = dayStartEquity * r.maxDailyLossPct / 100;
  const dayPnl = equity - dayStartEquity;
  add('Daily loss limit', dayPnl > -lossLimit, `Today ${dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(2)} vs limit -${lossLimit.toFixed(2)}`);
  const peak = Math.max(state.account.peakEquity, equity);
  const ddPct = peak > 0 ? (peak - equity) / peak * 100 : 0;
  add('Max drawdown', ddPct < r.maxDrawdownPct, `Drawdown ${ddPct.toFixed(2)}% from peak ${peak.toFixed(2)} (max ${r.maxDrawdownPct}%)`);
  add('Consecutive losses', today.consecutiveLossesToday < r.maxConsecutiveLosses, `${today.consecutiveLossesToday} consecutive loss(es) today (max ${r.maxConsecutiveLosses})`);
  add('Daily trade limit', today.tradesToday < r.maxTradesPerDay, `${today.tradesToday} trade(s) today (max ${r.maxTradesPerDay})`);
  add('Max open positions', state.positions.length < r.maxOpenPositions, `${state.positions.length} open (max ${r.maxOpenPositions})`);
  const dup = state.positions.some(p => p.assetId === d.assetId) || state.seenOrderKeys.includes(d.id);
  add('Duplicate order', !dup, dup ? 'Already holding this asset or this exact signal was already executed' : 'No duplicate');

  const exposureNow = openNotional(state, ctx.prices);
  const headroom = Math.max(0, equity * r.maxTotalExposurePct / 100 - exposureNow);
  const size = sizePosition({ equity, riskPct: r.riskPerTradePct, entry: fill, stop, spec, maxLeverage: r.maxLeverage, exposureHeadroomUsd: headroom });
  add('Position size', size.qty > 0, size.qty > 0 ? `${size.qty} units, risk $${size.riskUsd.toFixed(2)} (${(size.riskUsd / equity * 100).toFixed(2)}% of equity)` : (size.note ?? 'Size is zero'));
  add('Leverage / exposure', size.qty > 0 && size.leverage <= r.maxLeverage + 1e-9, `Leverage ${size.leverage.toFixed(2)}× (max ${r.maxLeverage}×), exposure after ≤ ${r.maxTotalExposurePct}% of equity`);

  const approved = checks.every(c => c.passed);
  return { approved, checks, qty: approved ? size.qty : 0, riskUsd: size.riskUsd, notionalUsd: size.notionalUsd, leverage: size.leverage, sizeNote: size.note };
}
