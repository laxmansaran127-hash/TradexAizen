import type { Candle, Timeframe } from '@/types/trading';
import { TF_SECONDS } from '@/types/trading';
import type {
  AizenDecision, AizenSettings, AizenState, DecisionRecord, ExitReason, FillLeg, PaperPosition, PendingOrder,
  PriceMap, RiskVerdict, TradeRecord,
} from './types';
import { LIVE_TRADING_AVAILABLE } from './types';
import { floorToStep, getSpec, notionalUsd, pnlUsd } from './instruments';
import { DEFAULT_SETTINGS, evaluateRisk, sanitizeExecution, sanitizeRisk } from './risk';

// ── Paper-trading engine (simulation only) ──────────────────────
// Nothing here talks to an exchange or broker. Every fill is simulated against REAL market
// candles/prices; records are tagged accountType 'paper' and executionStatus 'filled_paper'.
//
// Fill model (all documented assumptions):
//  • entries : latest real price ± adverse slippage, commission per InstrumentSpec
//  • exits   : evaluated ONCE per CLOSED candle (immutable OHLC) – never on the forming bar
//  • inside a candle the order of events is unknown ⇒ PESSIMISTIC: stop before targets; a
//    breakeven stop set by TP1 also counts if that same candle traded back through it
//  • stops fill at the stop (or at the open if the candle gapped through it) with adverse slippage;
//    targets fill at the target price (limit orders)
//  • the entry candle itself is only trusted from entry → close (we cannot know what happened earlier in it)

const STRATEGY = 'TradeXLive confluence (structure · liquidity · MTF · gated)';
const CAP = { decisions: 150, riskEvents: 200, executionLog: 300, seenKeys: 2000 };
const EPS = 0.005; // $ — below this a trade is "breakeven"

export const newId = (p: string): string => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const cap = <T,>(a: T[], n: number): void => { if (a.length > n) a.splice(0, a.length - n); };

export function createInitialState(settings: Partial<AizenSettings> = {}): AizenState {
  const risk = sanitizeRisk(settings.risk);
  const merged: AizenSettings = {
    ...DEFAULT_SETTINGS, ...settings, risk, execution: sanitizeExecution(settings.execution),
    markets: { ...DEFAULT_SETTINGS.markets, ...(settings.markets ?? {}) },
  };
  // Safety: stored settings can never switch live trading on.
  if (merged.mode === 'live' && !LIVE_TRADING_AVAILABLE) merged.mode = 'paper';
  return {
    version: 1, accountType: 'paper', settings: merged,
    account: { startingEquity: risk.startingEquity, balance: risk.startingEquity, peakEquity: risk.startingEquity },
    positions: [], pending: [], trades: [], decisions: [], riskEvents: [], executionLog: [],
    seenOrderKeys: [], lastAnalyzedBar: {}, heartbeat: { lastCycleAt: null, lastError: null, cycles: 0 },
  };
}

export function logExec(s: AizenState, kind: 'order' | 'fill' | 'close' | 'reject' | 'system', message: string, now: number): void {
  s.executionLog.push({ id: newId('x'), time: now, kind, message }); cap(s.executionLog, CAP.executionLog);
}
export function logRisk(s: AizenState, level: 'info' | 'warn' | 'block', code: string, message: string, now: number): void {
  s.riskEvents.push({ id: newId('r'), time: now, level, code, message }); cap(s.riskEvents, CAP.riskEvents);
}
export function recordDecision(s: AizenState, decision: AizenDecision, outcome: DecisionRecord['outcome'], rejectReasons: string[], now: number): void {
  s.decisions.push({ id: newId('d'), time: now, decision, outcome, rejectReasons }); cap(s.decisions, CAP.decisions);
}

// ── Opening ─────────────────────────────────────────────────────
export type OpenResult = { ok: true; position: PaperPosition } | { ok: false; reason: string };

export function openPaperPosition(s: AizenState, d: AizenDecision, v: RiskVerdict, livePrice: number, now: number): OpenResult {
  // Defence in depth: the executor re-checks the hard preconditions itself.
  if (s.settings.mode === 'live' || LIVE_TRADING_AVAILABLE) return { ok: false, reason: 'Live execution is not implemented — paper engine only' };
  if (s.settings.emergencyStopped) return { ok: false, reason: 'Emergency STOP active' };
  if (!v.approved || v.qty <= 0) return { ok: false, reason: 'Risk layer did not approve this order' };
  if (s.seenOrderKeys.includes(d.id)) return { ok: false, reason: 'Duplicate order (idempotency key already used)' };
  if (s.positions.some(p => p.assetId === d.assetId)) return { ok: false, reason: 'Position already open for this asset' };
  if (d.decision !== 'LONG' && d.decision !== 'SHORT') return { ok: false, reason: 'No trade' };

  const spec = getSpec(d.assetId);
  const long = d.decision === 'LONG';
  const fill = long ? livePrice * (1 + spec.slippageBps / 1e4) : livePrice * (1 - spec.slippageBps / 1e4);
  const fee = notionalUsd(spec, v.qty, fill) * spec.feeBps / 1e4;
  const pos: PaperPosition = {
    id: newId('pos'), orderKey: d.id, assetId: d.assetId, symbol: d.symbol, category: d.category,
    direction: long ? 'long' : 'short', entryPrice: fill, plannedEntry: d.entry!, qty: v.qty, remainingQty: v.qty,
    initialStop: d.stopLoss!, stop: d.stopLoss!, tp1: d.tp1!, tp2: d.tp2!, tp3: d.tp3!, tpHit: 0,
    entryTime: now, timeframe: d.timeframe, strategy: STRATEGY, reasoning: d.reasoning,
    riskUsd: v.riskUsd, leverage: v.leverage, fees: fee, realizedPnl: 0,
    legs: [{ time: now, price: fill, qty: v.qty, reason: 'entry', fee, pnl: 0 }], decisionId: d.id, lastBarTime: 0,
  };
  s.account.balance -= fee;
  s.positions.push(pos);
  s.seenOrderKeys.push(d.id); cap(s.seenOrderKeys, CAP.seenKeys);
  logExec(s, 'fill', `PAPER ${pos.direction.toUpperCase()} ${pos.symbol} ${pos.qty} @ ${fill} (stop ${pos.stop}, TP1 ${pos.tp1}) — simulated, no broker order`, now);
  return { ok: true, position: pos };
}

// ── Booking fills / closing ─────────────────────────────────────
function bookExit(s: AizenState, pos: PaperPosition, price: number, qty: number, reason: string, time: number): void {
  const spec = getSpec(pos.assetId);
  const q = Math.min(qty, pos.remainingQty);
  const pnl = pnlUsd(spec, pos.direction === 'long' ? 1 : -1, pos.entryPrice, price, q);
  const fee = notionalUsd(spec, q, price) * spec.feeBps / 1e4;
  s.account.balance += pnl - fee;
  pos.realizedPnl += pnl; pos.fees += fee; pos.remainingQty = Math.max(0, Number((pos.remainingQty - q).toFixed(8)));
  const leg: FillLeg = { time, price, qty: q, reason, fee, pnl };
  pos.legs.push(leg);
}

function finalize(s: AizenState, pos: PaperPosition, reason: ExitReason): TradeRecord {
  const exits = pos.legs.filter(l => l.reason !== 'entry');
  const exitQty = exits.reduce((a, l) => a + l.qty, 0);
  const exitPrice = exitQty > 0 ? exits.reduce((a, l) => a + l.price * l.qty, 0) / exitQty : pos.entryPrice;
  const gross = exits.reduce((a, l) => a + l.pnl, 0);
  const fees = pos.legs.reduce((a, l) => a + l.fee, 0);
  const net = gross - fees;
  const rec: TradeRecord = {
    id: newId('t'), accountType: 'paper', assetId: pos.assetId, symbol: pos.symbol, category: pos.category, direction: pos.direction,
    entryPrice: pos.entryPrice, exitPrice, stopLoss: pos.initialStop, takeProfit: { tp1: pos.tp1, tp2: pos.tp2, tp3: pos.tp3 },
    qty: pos.qty, leverage: pos.leverage, entryTime: pos.entryTime, exitTime: exits[exits.length - 1]?.time ?? pos.entryTime,
    grossPnl: gross, fees, realizedPnl: net, outcome: net > EPS ? 'win' : net < -EPS ? 'loss' : 'breakeven',
    rMultiple: pos.riskUsd > 0 ? net / pos.riskUsd : null, strategy: pos.strategy, timeframe: pos.timeframe,
    reasoning: pos.reasoning, executionStatus: 'filled_paper', exitReason: reason, decisionId: pos.decisionId, legs: pos.legs,
  };
  s.trades.push(rec);
  s.positions = s.positions.filter(p => p.id !== pos.id);
  logExec(s, 'close', `PAPER CLOSED ${pos.symbol} ${reason}: net ${net >= 0 ? '+' : ''}${net.toFixed(2)} USD (fees ${fees.toFixed(2)})`, rec.exitTime);
  return rec;
}

/** Close the remaining quantity at a market price (adverse slippage applied). */
export function closePositionAtMarket(s: AizenState, posId: string, price: number, reason: 'manual' | 'emergency_flatten', now: number): TradeRecord | null {
  const pos = s.positions.find(p => p.id === posId);
  if (!pos || !(price > 0)) return null;
  const spec = getSpec(pos.assetId);
  const slip = spec.slippageBps / 1e4;
  const px = pos.direction === 'long' ? price * (1 - slip) : price * (1 + slip);
  bookExit(s, pos, px, pos.remainingQty, reason, now);
  return finalize(s, pos, reason);
}

// ── Monitoring (closed candles only) ────────────────────────────
function applyBar(s: AizenState, pos: PaperPosition, bar: Candle, tfSec: number): TradeRecord | null {
  const spec = getSpec(pos.assetId);
  const long = pos.direction === 'long';
  const slip = spec.slippageBps / 1e4;
  const t = bar.time + tfSec;
  const exec = sanitizeExecution(s.settings.execution);
  const stopFill = (stop: number, open: number) => {
    const raw = long ? Math.min(stop, open) : Math.max(stop, open);   // gap through the stop ⇒ worse fill
    return long ? raw * (1 - slip) : raw * (1 + slip);
  };
  const stopHit = (stop: number, b: Candle) => (long ? b.low <= stop : b.high >= stop);
  const stopReason = (): ExitReason => (pos.tpHit >= 1 && pos.stop === pos.entryPrice ? 'breakeven_stop' : 'stop');

  // the entry candle: only the path entry → close is known
  let b = bar;
  if (bar.time <= pos.entryTime) b = { ...bar, open: pos.entryPrice, high: Math.max(pos.entryPrice, bar.close), low: Math.min(pos.entryPrice, bar.close) };

  if (stopHit(pos.stop, b)) {
    const reason = stopReason();
    bookExit(s, pos, stopFill(pos.stop, b.open), pos.remainingQty, reason, t);
    return finalize(s, pos, reason);
  }
  let movedStop = false;
  const tps = [pos.tp1, pos.tp2, pos.tp3];
  for (let k = pos.tpHit + 1; k <= 3; k++) {
    const tp = tps[k - 1];
    if (!(long ? b.high >= tp : b.low <= tp)) break;
    const q = k === 3 ? pos.remainingQty : Math.min(pos.remainingQty, floorToStep(pos.qty * exec.scaleOut[k - 1], spec.qtyStep));
    if (q > 0) bookExit(s, pos, tp, q, `tp${k}`, t);
    pos.tpHit = k as 1 | 2 | 3;
    if (k === 1 && exec.moveStopToBreakevenAfterTp1) { pos.stop = pos.entryPrice; movedStop = true; }
    if (pos.remainingQty <= 0) return finalize(s, pos, 'tp3');
  }
  if (movedStop && pos.remainingQty > 0 && stopHit(pos.stop, b)) {
    bookExit(s, pos, stopFill(pos.stop, b.open), pos.remainingQty, 'breakeven_stop', t);
    return finalize(s, pos, 'breakeven_stop');
  }
  return null;
}

/**
 * Process every newly CLOSED candle for each open position. Idempotent: a bar is processed once
 * (tracked by lastBarTime), so repeated calls / restarts never double-fill.
 */
export function monitorPositions(s: AizenState, bars: { [assetId: string]: Candle[] | undefined }, nowSec: number): TradeRecord[] {
  const closed: TradeRecord[] = [];
  for (const pos of [...s.positions]) {
    const list = bars[pos.assetId];
    if (!list) continue;
    const tf: Timeframe = pos.timeframe;
    const tfSec = TF_SECONDS[tf];
    for (const bar of list) {
      if (bar.time + tfSec > nowSec) continue;          // forming bar — never used
      if (bar.time + tfSec <= pos.entryTime) continue;  // finished before we entered
      if (bar.time <= pos.lastBarTime) continue;        // already processed
      pos.lastBarTime = bar.time;
      const rec = applyBar(s, pos, bar, tfSec);
      if (rec) { closed.push(rec); break; }
    }
  }
  return closed;
}

// ── Executing a decision (risk layer is mandatory) ──────────────
export interface ExecContext { nowSec: number; prices: PriceMap; livePrice: number | null; spreadBps: number | null; feed?: 'fresh' | 'stale' }

export function processDecision(s: AizenState, d: AizenDecision, c: ExecContext): DecisionRecord['outcome'] {
  if (d.decision === 'NO TRADE' || d.decision === 'WAIT') { recordDecision(s, d, 'no_trade', [], c.nowSec); return 'no_trade'; }
  const v = evaluateRisk(s, d, c);
  if (!v.approved) {
    const failed = v.checks.filter(x => !x.passed);
    const dup = failed.some(x => x.name === 'Duplicate order');
    const reasons = failed.map(x => `${x.name}: ${x.note}`);
    recordDecision(s, d, dup ? 'duplicate' : 'rejected_risk', reasons, c.nowSec);
    logRisk(s, 'block', dup ? 'duplicate' : 'risk_reject', `${d.symbol} ${d.decision} rejected — ${reasons.join(' | ')}`, c.nowSec);
    logExec(s, 'reject', `${d.symbol} ${d.decision} NOT executed: ${failed[0]?.name}`, c.nowSec);
    return dup ? 'duplicate' : 'rejected_risk';
  }
  if (s.settings.mode === 'approval') {
    const exp = c.nowSec + Math.min(TF_SECONDS[d.timeframe], 1800);
    s.pending.push({ id: newId('pend'), decision: d, createdAt: c.nowSec, expiresAt: exp });
    recordDecision(s, d, 'pending_approval', [], c.nowSec);
    logExec(s, 'order', `${d.symbol} ${d.decision} waiting for your approval (expires in ≤30 min)`, c.nowSec);
    return 'pending_approval';
  }
  const res = openPaperPosition(s, d, v, c.livePrice!, c.nowSec);
  if (!res.ok) { recordDecision(s, d, 'rejected_risk', [res.reason], c.nowSec); logExec(s, 'reject', `${d.symbol}: ${res.reason}`, c.nowSec); return 'rejected_risk'; }
  recordDecision(s, d, 'executed_paper', [], c.nowSec);
  return 'executed_paper';
}

// ── Approval queue ──────────────────────────────────────────────
export function expirePending(s: AizenState, nowSec: number): void {
  const keep: PendingOrder[] = [];
  for (const p of s.pending) {
    if (p.expiresAt > nowSec) keep.push(p);
    else { recordDecision(s, p.decision, 'expired', ['Approval window expired'], nowSec); logExec(s, 'system', `${p.decision.symbol} approval expired`, nowSec); }
  }
  s.pending = keep;
}

/** Approval re-runs the FULL risk gate against current prices — an old approval can never bypass it. */
export function approvePending(s: AizenState, id: string, c: ExecContext): { ok: boolean; reason?: string } {
  const p = s.pending.find(x => x.id === id);
  if (!p) return { ok: false, reason: 'Pending order not found' };
  s.pending = s.pending.filter(x => x.id !== id);
  if (p.expiresAt <= c.nowSec) { recordDecision(s, p.decision, 'expired', ['Approval window expired'], c.nowSec); return { ok: false, reason: 'Expired' }; }
  const v = evaluateRisk(s, p.decision, c);
  if (!v.approved) {
    const reasons = v.checks.filter(x => !x.passed).map(x => `${x.name}: ${x.note}`);
    recordDecision(s, p.decision, 'rejected_risk', reasons, c.nowSec);
    logRisk(s, 'block', 'approval_reject', `${p.decision.symbol} approval rejected at execution — ${reasons.join(' | ')}`, c.nowSec);
    return { ok: false, reason: reasons[0] };
  }
  const res = openPaperPosition(s, p.decision, v, c.livePrice!, c.nowSec);
  if (!res.ok) return { ok: false, reason: res.reason };
  recordDecision(s, p.decision, 'approved', [], c.nowSec);
  return { ok: true };
}

export function declinePending(s: AizenState, id: string, nowSec: number): void {
  const p = s.pending.find(x => x.id === id);
  if (!p) return;
  s.pending = s.pending.filter(x => x.id !== id);
  recordDecision(s, p.decision, 'declined', ['Declined by user'], nowSec);
}

// ── Emergency STOP ──────────────────────────────────────────────
/** Blocks every new order immediately, clears the approval queue, switches the agent off, then applies the policy to open positions. */
export function emergencyStop(s: AizenState, prices: PriceMap, nowSec: number): void {
  s.settings.emergencyStopped = true;
  s.settings.agentOn = false;
  for (const p of s.pending) recordDecision(s, p.decision, 'declined', ['Emergency STOP'], nowSec);
  s.pending = [];
  logRisk(s, 'block', 'emergency_stop', `Emergency STOP — policy: ${s.settings.emergencyPolicy}`, nowSec);
  if (s.settings.emergencyPolicy === 'flatten') {
    for (const pos of [...s.positions]) {
      const px = prices[pos.assetId];
      if (px && px > 0) closePositionAtMarket(s, pos.id, px, 'emergency_flatten', nowSec);
      else logRisk(s, 'warn', 'flatten_no_price', `No live price for ${pos.symbol}: position kept and still protected by its stop/targets`, nowSec);
    }
  }
}

/** Explicit user action only. Leaves the agent OFF. */
export function clearEmergencyStop(s: AizenState, nowSec: number): void {
  s.settings.emergencyStopped = false;
  logRisk(s, 'info', 'emergency_cleared', 'Emergency STOP cleared by user (agent remains OFF)', nowSec);
}
