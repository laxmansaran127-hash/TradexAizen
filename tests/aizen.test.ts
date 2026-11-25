import { test, section, done, assert, approx, randomWalk } from './harness';
import type { Candle, Timeframe } from '../src/types/trading';
import { ASSET_CONFIGS, TF_SECONDS } from '../src/types/trading';
import type { AizenDecision, AizenState, TradeRecord } from '../src/lib/aizen/types';
import { LIVE_TRADING_AVAILABLE } from '../src/lib/aizen/types';
import { getSpec, pnlUsd } from '../src/lib/aizen/instruments';
import { DEFAULT_RISK, evaluateRisk, sanitizeRisk, sizePosition } from '../src/lib/aizen/risk';
import {
  approvePending, clearEmergencyStop, createInitialState, declinePending, emergencyStop, expirePending,
  monitorPositions, openPaperPosition, processDecision,
} from '../src/lib/aizen/paperEngine';
import { computeStats, equityCurve, filterByAccount, periodBreakdown } from '../src/lib/aizen/stats';
import { hydrateState, loadState, saveState, PAPER_STORAGE_KEY, resetPaperAccount, claimLock, releaseLock, LOCK_KEY, LOCK_TTL_MS } from '../src/lib/aizen/store';
import { buildDecision } from '../src/lib/aizen/bridge';
import { feedFreshness, latestPrice, runCycle, type AgentDeps } from '../src/lib/aizen/agent';
import { runAnalysis } from '../src/lib/analysis/engine';
import type { NewsRiskDetail } from '../src/lib/analysis/types';
import { riskStatus } from '../src/lib/aizen/status';
import { acquireWorkerLock, loadStateFile, releaseWorkerLock, saveStateFile } from '../scripts/aizen-worker';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// All fixtures below are TEST DATA (hand-written numbers / the deterministic generator in harness.ts).
// They exist only inside this file and never ship in the app.

const H = 3600;
const E = 1_700_000_000 + 1800;             // entry moment: mid-bar
const ENTRY_BAR = Math.floor(E / H) * H;
const bar = (time: number, o: number, h: number, l: number, c: number): Candle => ({ time, open: o, high: h, low: l, close: c, volume: 1 });
const NEWS_OK: NewsRiskDetail = { level: 'low', phase: null, drivers: [], coverage: 'calendar' };

function decision(over: Partial<AizenDecision> = {}): AizenDecision {
  return {
    id: 'BTC:1H:1699999999:long', assetId: 'BTC', symbol: 'BTC/USDT', category: 'crypto', timeframe: '1H', decision: 'LONG', asOf: 1699999999,
    entry: 100, stopLoss: 98, tp1: 103, tp2: 106, tp3: 109, riskReward: 3, atr: 1.5, engineDecision: 'BUY', engineReason: 'fixture',
    reasoning: ['fixture'], gates: [], newsCoverage: 'calendar', feed: 'fresh', createdAt: E, ...over,
  };
}
function fresh(over: Partial<AizenState['settings']> = {}): AizenState {
  return createInitialState({ agentOn: true, assets: ['BTC'], markets: { crypto: true, forex: false, gold: false }, ...over });
}
const ctx = (s: AizenState, live: number | null = 100, extra: object = {}) => ({ nowSec: E, prices: { BTC: live ?? undefined }, livePrice: live, spreadBps: null, ...extra });
function openOne(s: AizenState, d = decision()) {
  const outcome = processDecision(s, d, ctx(s));
  assert(outcome === 'executed_paper', `expected executed_paper, got ${outcome}: ${JSON.stringify(s.decisions[s.decisions.length - 1]?.rejectReasons)}`);
  return s.positions[0];
}
function fakeTrade(pnl: number, exitTime: number, outcome?: TradeRecord['outcome'], type: 'paper' | 'live' = 'paper'): TradeRecord {
  const o = outcome ?? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven');
  return {
    id: `t${exitTime}${pnl}`, accountType: type as 'paper', assetId: 'BTC', symbol: 'BTC/USDT', category: 'crypto', direction: 'long', entryPrice: 100, exitPrice: 101,
    stopLoss: 98, takeProfit: { tp1: 103, tp2: 106, tp3: 109 }, qty: 1, leverage: 1, entryTime: exitTime - 600, exitTime, grossPnl: pnl, fees: 0, realizedPnl: pnl,
    outcome: o, rMultiple: pnl / 50, strategy: 't', timeframe: '1H', reasoning: [], executionStatus: 'filled_paper', exitReason: 'stop', decisionId: 'x',
    legs: [{ time: exitTime, price: 101, qty: 1, reason: 'stop', fee: 0, pnl }],
  };
}
/** Ledger invariant: cash balance == starting equity + every booked leg (entries' fees included). */
function ledger(s: AizenState) {
  const legs = [...s.trades.flatMap(t => t.legs), ...s.positions.flatMap(p => p.legs)];
  const expected = s.account.startingEquity + legs.reduce((a, l) => a + l.pnl - l.fee, 0);
  approx(s.account.balance, expected, 1e-6, 'balance vs legs');
  for (const t of s.trades) approx(t.realizedPnl, t.legs.reduce((a, l) => a + l.pnl - l.fee, 0), 1e-6, 'trade net vs legs');
}

// ════════════════════════════════════════════════════════════════
section('Position sizing');
test('risk = equity × risk%; qty = risk ÷ stop distance', () => {
  const r = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 100, stop: 98, spec: getSpec('BTC'), maxLeverage: 2, exposureHeadroomUsd: 1e9 });
  approx(r.qty, 25, 1e-6); approx(r.riskUsd, 50, 1e-6); approx(r.leverage, 0.25, 1e-9); assert(r.note === null);
});
test('leverage cap reduces size (and risk) instead of exceeding the cap', () => {
  const r = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 100, stop: 99.9, spec: getSpec('BTC'), maxLeverage: 2, exposureHeadroomUsd: 1e9 });
  approx(r.notionalUsd, 20_000, 1); assert(r.riskUsd < 50 && r.note !== null);
});
test('exposure headroom of zero ⇒ no position', () => {
  const r = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 100, stop: 98, spec: getSpec('BTC'), maxLeverage: 2, exposureHeadroomUsd: 0 });
  assert(r.qty === 0);
});
test('USD/JPY: quote currency converted to USD, micro-lot steps', () => {
  const spec = getSpec('USDJPY');
  const r = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 150, stop: 149.5, spec, maxLeverage: 2, exposureHeadroomUsd: 1e9 });
  approx(r.qty, 15_000, 1e-6); approx(r.riskUsd, 50, 0.01);
  approx(pnlUsd(spec, 1, 150, 151, 15_000), 15_000 / 151, 1e-9);
});
test('EUR/USD and XAU/USD sizing hit the requested risk', () => {
  const e = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 1.1, stop: 1.095, spec: getSpec('EURUSD'), maxLeverage: 10, exposureHeadroomUsd: 1e9 });
  approx(e.riskUsd, 50, 0.6);
  const g = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 2000, stop: 1990, spec: getSpec('GOLD'), maxLeverage: 10, exposureHeadroomUsd: 1e9 });
  approx(g.qty, 5, 1e-6); approx(g.riskUsd, 50, 1e-6);
});
test('never sizes UP to recover losses: after a loss the next position risks LESS', () => {
  const a = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 100, stop: 98, spec: getSpec('BTC'), maxLeverage: 2, exposureHeadroomUsd: 1e9 });
  const b = sizePosition({ equity: 9_000, riskPct: 0.5, entry: 100, stop: 98, spec: getSpec('BTC'), maxLeverage: 2, exposureHeadroomUsd: 1e9 });
  assert(b.riskUsd < a.riskUsd && b.qty < a.qty);
});
test('invalid inputs never produce a size', () => {
  for (const bad of [{ stop: 100 }, { equity: 0 }, { entry: 0 }, { equity: NaN }]) {
    const r = sizePosition({ equity: 10_000, riskPct: 0.5, entry: 100, stop: 98, spec: getSpec('BTC'), maxLeverage: 2, exposureHeadroomUsd: 1e9, ...bad });
    assert(r.qty === 0, JSON.stringify(bad));
  }
});
test('settings are clamped to hard limits (risk/trade ≤ 2%, leverage ≤ 10×, R:R ≥ 1)', () => {
  const r = sanitizeRisk({ riskPerTradePct: 50, maxLeverage: 500, minRewardToRisk: 0.1, maxDailyLossPct: 99, maxDrawdownPct: 99, riskPerTradePctX: 1 } as never);
  assert(r.riskPerTradePct === 2 && r.maxLeverage === 10 && r.minRewardToRisk === 1 && r.maxDailyLossPct === 10 && r.maxDrawdownPct === 30);
  const bad = sanitizeRisk({ riskPerTradePct: NaN, maxOpenPositions: 'x' } as never);
  assert(bad.riskPerTradePct === DEFAULT_RISK.riskPerTradePct && bad.maxOpenPositions === DEFAULT_RISK.maxOpenPositions);
});
test('defaults are conservative', () => {
  assert(DEFAULT_RISK.riskPerTradePct <= 0.5 && DEFAULT_RISK.maxLeverage <= 2 && DEFAULT_RISK.requireNewsCoverage);
  const s = createInitialState();
  assert(s.settings.mode === 'paper' && !s.settings.agentOn && !s.settings.emergencyStopped);
});

// ════════════════════════════════════════════════════════════════
section('Risk gate');
const check = (s: AizenState, d: AizenDecision, name: string, c = ctx(s)) => {
  const v = evaluateRisk(s, d, c);
  return { v, c: v.checks.find(x => x.name === name) };
};
test('a clean setup is approved with a size', () => {
  const s = fresh(); const v = evaluateRisk(s, decision(), ctx(s));
  assert(v.approved && v.qty > 0 && v.riskUsd > 0 && v.riskUsd <= 50.0001, JSON.stringify(v.checks.filter(c => !c.passed)));
});
test('rejects: emergency stop, stale data, no news coverage, disabled market, unknown mode', () => {
  const s = fresh({ emergencyStopped: true }); assert(!check(s, decision(), 'Emergency stop').c!.passed);
  assert(!check(fresh(), decision({ feed: 'stale' }), 'Market data fresh').c!.passed);
  assert(!check(fresh(), decision({ newsCoverage: 'none' }), 'News coverage').c!.passed);
  assert(check(fresh({ risk: { ...DEFAULT_RISK, requireNewsCoverage: false } }), decision({ newsCoverage: 'none' }), 'News coverage').c!.passed);
  assert(!check(fresh({ markets: { crypto: false, forex: false, gold: false } }), decision(), 'Market enabled').c!.passed);
  assert(!check(fresh({ assets: ['ETH'] }), decision(), 'Market enabled').c!.passed);
});
test('rejects incomplete / NaN plans and WAIT / NO TRADE', () => {
  for (const d of [decision({ stopLoss: null }), decision({ tp2: NaN }), decision({ atr: null }), decision({ decision: 'WAIT' }), decision({ decision: 'NO TRADE' })]) {
    assert(!evaluateRisk(fresh(), d, ctx(fresh())).approved);
  }
});
test('rejects when no live price, or price already through the stop / targets', () => {
  const s = fresh();
  assert(!evaluateRisk(s, decision(), ctx(s, null)).approved);
  assert(!check(s, decision(), 'Levels valid at fill', ctx(s, 97)).c!.passed);
  assert(!check(s, decision(), 'Levels valid at fill', ctx(s, 104)).c!.passed);
});
test('rejects R:R below the minimum (recomputed from the expected fill, not trusted from the plan)', () => {
  const s = fresh();
  assert(!check(s, decision({ tp1: 100.5, tp2: 101, tp3: 102 }), 'Reward:risk').c!.passed);
  assert(!check(s, decision({ riskReward: 9 , tp1: 100.5, tp2: 101, tp3: 102 }), 'Reward:risk').c!.passed);
});
test('rejects entry drift beyond maxEntryDriftAtr', () => {
  const s = fresh(); assert(!check(s, decision(), 'Entry drift', ctx(s, 101.5)).c!.passed);   // 1.0 ATR
  assert(check(s, decision(), 'Entry drift', ctx(s, 100.5)).c!.passed);                       // 0.33 ATR
});
test('spread filter: measured spread above max rejects; missing quote is declared ASSUMED', () => {
  const s = fresh();
  const wide = check(s, decision(), 'Spread', ctx(s, 100, { spreadBps: 50 }));
  assert(!wide.c!.passed && wide.c!.note.includes('measured'));
  const assumed = check(s, decision(), 'Spread');
  assert(assumed.c!.passed && assumed.c!.note.includes('ASSUMED'));
});
test('daily loss limit blocks new trades', () => {
  const s = fresh(); s.trades.push(fakeTrade(-250, E - 600)); s.account.balance -= 250;
  assert(!check(s, decision(), 'Daily loss limit').c!.passed);
  const ok = fresh(); ok.trades.push(fakeTrade(-100, E - 600)); ok.account.balance -= 100;
  assert(check(ok, decision(), 'Daily loss limit').c!.passed);
});
test('yesterday\'s losses do not count toward today\'s limits', () => {
  const s = fresh(); s.trades.push(fakeTrade(-250, E - 2 * 86400)); s.account.balance -= 250;
  assert(check(s, decision(), 'Daily loss limit').c!.passed && check(s, decision(), 'Consecutive losses').c!.passed);
});
test('max consecutive losses (today) blocks; a win in between resets the streak', () => {
  const s = fresh(); [-10, -10, -10].forEach((p, i) => s.trades.push(fakeTrade(p, E - 900 + i * 60))); s.account.balance -= 30;
  assert(!check(s, decision(), 'Consecutive losses').c!.passed);
  const w = fresh(); [-10, -10, 5, -10].forEach((p, i) => w.trades.push(fakeTrade(p, E - 900 + i * 60)));
  assert(check(w, decision(), 'Consecutive losses').c!.passed);
});
test('max daily trades', () => {
  const s = fresh({ risk: { ...DEFAULT_RISK, maxTradesPerDay: 2 } });
  s.trades.push(fakeTrade(5, E - 500), fakeTrade(5, E - 400));
  assert(!check(s, decision(), 'Daily trade limit').c!.passed);
});
test('max open positions', () => {
  const s = fresh({ assets: ['BTC', 'ETH', 'SOL'], risk: { ...DEFAULT_RISK, maxOpenPositions: 1 } });
  openOne(s);
  const eth = decision({ id: 'ETH:1H:1:long', assetId: 'ETH', symbol: 'ETH/USDT' });
  const v = evaluateRisk(s, eth, { ...ctx(s), prices: { BTC: 100, ETH: 100 } });
  assert(!v.approved && !v.checks.find(c => c.name === 'Max open positions')!.passed);
});
test('max drawdown from peak equity blocks new trades', () => {
  const s = fresh(); s.account.peakEquity = 12_000;            // equity 10,000 ⇒ 16.7% below peak (limit 10%)
  assert(!check(s, decision(), 'Max drawdown').c!.passed);
  s.account.peakEquity = 10_500; assert(check(s, decision(), 'Max drawdown').c!.passed);
});
test('total exposure cap reduces / blocks size', () => {
  const s = fresh({ risk: { ...DEFAULT_RISK, maxTotalExposurePct: 10 } });   // 10% of 10k = $1,000 notional
  const v = evaluateRisk(s, decision(), ctx(s));
  assert(v.approved && v.notionalUsd <= 1000.0001 && v.sizeNote !== null);
  const tiny = fresh({ risk: { ...DEFAULT_RISK, maxTotalExposurePct: 10 } }); tiny.account.balance = 10_000;
  const none = evaluateRisk(tiny, decision({ entry: 100, stopLoss: 98 }), { ...ctx(tiny), livePrice: 100 });
  assert(none.notionalUsd <= 1000.0001);
});

// ════════════════════════════════════════════════════════════════
section('Paper execution, duplicate prevention, rejected orders');
test('opens a PAPER position: simulated fill with slippage, entry fee booked, ledger consistent', () => {
  const s = fresh(); const p = openOne(s);
  approx(p.entryPrice, 100 * (1 + 2 / 1e4), 1e-9);
  assert(p.fees > 0 && p.direction === 'long' && p.stop === 98 && p.legs[0].reason === 'entry');
  approx(s.account.balance, 10_000 - p.fees, 1e-9);
  assert(s.executionLog.some(l => l.message.includes('simulated, no broker order')));
  assert(s.decisions[s.decisions.length - 1]!.outcome === 'executed_paper' && s.seenOrderKeys.includes(p.orderKey));
  ledger(s);
});
test('duplicate signal is rejected (same asset already open)', () => {
  const s = fresh(); openOne(s);
  assert(processDecision(s, decision(), ctx(s)) === 'duplicate');
  assert(s.positions.length === 1);
});
test('a signal can never be executed twice even after its position closed (idempotency key)', () => {
  const s = fresh(); const p = openOne(s);
  monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 99, 99, 90, 91)] }, E + 5 * H);
  assert(s.positions.length === 0 && s.trades.length === 1 && p.orderKey === decision().id);
  assert(processDecision(s, decision(), ctx(s)) === 'duplicate');
  assert(s.positions.length === 0);
  const direct = openPaperPosition(s, decision(), { approved: true, checks: [], qty: 1, riskUsd: 1, notionalUsd: 100, leverage: 0.01, sizeNote: null }, 100, E);
  assert(!direct.ok);
});
test('executor refuses unapproved verdicts even if called directly', () => {
  const s = fresh();
  const r = openPaperPosition(s, decision(), { approved: false, checks: [], qty: 5, riskUsd: 1, notionalUsd: 1, leverage: 0, sizeNote: null }, 100, E);
  assert(!r.ok && s.positions.length === 0);
});
test('rejected order leaves no position and is logged (risk event + execution log + decision record)', () => {
  const s = fresh(); const out = processDecision(s, decision({ feed: 'stale' }), ctx(s));
  assert(out === 'rejected_risk' && s.positions.length === 0 && s.account.balance === 10_000);
  assert(s.riskEvents.some(e => e.level === 'block') && s.executionLog.some(l => l.kind === 'reject'));
  assert(s.decisions[s.decisions.length - 1]!.rejectReasons.some(r => r.includes('stale')));
});
test('NO TRADE / WAIT are recorded and never executed', () => {
  const s = fresh();
  assert(processDecision(s, decision({ decision: 'WAIT', id: 'w' }), ctx(s)) === 'no_trade');
  assert(processDecision(s, decision({ decision: 'NO TRADE', id: 'n' }), ctx(s)) === 'no_trade');
  assert(s.positions.length === 0);
});

// ════════════════════════════════════════════════════════════════
section('Stop loss / take profit management');
test('stop loss: closed LOSS at the stop (adverse slippage), net P&L = move − fees, ≈ −1R', () => {
  const s = fresh(); const p = openOne(s);
  const closed = monitorPositions(s, { BTC: [bar(ENTRY_BAR, 100, 100.4, 99.9, 100.2), bar(ENTRY_BAR + H, 99.5, 99.6, 97.5, 98.2)] }, E + 3 * H);
  assert(closed.length === 1 && s.positions.length === 0);
  const t = closed[0];
  const exit = 98 * (1 - 2 / 1e4);
  assert(t.outcome === 'loss' && t.exitReason === 'stop' && t.accountType === 'paper' && t.executionStatus === 'filled_paper');
  approx(t.exitPrice, exit, 1e-9);
  approx(t.realizedPnl, p.qty * (exit - p.entryPrice) - t.fees, 1e-6);
  assert(t.rMultiple! < -1 && t.rMultiple! > -1.25, `R ${t.rMultiple}`);
  assert(t.stopLoss === 98 && t.takeProfit.tp3 === 109 && t.reasoning.length > 0);
  ledger(s);
});
test('full take-profit ladder: 50/30/20 scale-out, stop moves to breakeven, WIN with exact P&L', () => {
  const s = fresh(); const p = openOne(s);
  const e = p.entryPrice, q = p.qty;
  const bars = [bar(ENTRY_BAR, 100, 100.3, 99.95, 100.1), bar(ENTRY_BAR + H, 100.6, 103.2, 100.5, 103), bar(ENTRY_BAR + 2 * H, 103, 109.5, 102.8, 109)];
  const closed = monitorPositions(s, { BTC: bars }, E + 4 * H);
  assert(closed.length === 1 && closed[0].exitReason === 'tp3' && closed[0].outcome === 'win');
  const q1 = Math.floor(q * 0.5 * 1e6) / 1e6, q2 = Math.floor(q * 0.3 * 1e6) / 1e6, q3 = q - q1 - q2;
  const gross = q1 * (103 - e) + q2 * (106 - e) + q3 * (109 - e);
  approx(closed[0].grossPnl, gross, 1e-4);
  assert(closed[0].legs.filter(l => l.reason.startsWith('tp')).length === 3);
  assert(closed[0].realizedPnl < gross && closed[0].fees > 0);
  ledger(s);
});
test('after TP1 the stop is moved to entry; a pullback to entry closes the rest at BREAKEVEN (still a net win)', () => {
  const s = fresh(); const p = openOne(s);
  monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 100.1, 103.5, 100.2, 103.1)] }, E + 2 * H);
  assert(s.positions[0].tpHit === 1 && s.positions[0].stop === p.entryPrice && s.positions[0].remainingQty < p.qty);
  const closed = monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 100.1, 103.5, 100.2, 103.1), bar(ENTRY_BAR + 2 * H, 103, 103.4, 99.8, 100.5)] }, E + 3 * H);
  assert(closed.length === 1 && closed[0].exitReason === 'breakeven_stop' && closed[0].outcome === 'win', `${closed[0]?.exitReason} ${closed[0]?.outcome}`);
  ledger(s);
});
test('same candle touches stop AND target ⇒ pessimistic: stop first', () => {
  const s = fresh(); openOne(s);
  const closed = monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 100, 107, 97, 105)] }, E + 2 * H);
  assert(closed[0].outcome === 'loss' && closed[0].exitReason === 'stop' && closed[0].legs.every(l => !l.reason.startsWith('tp')));
});
test('TP1 and a return through the new breakeven stop inside ONE candle ⇒ remainder stopped at entry', () => {
  const s = fresh(); openOne(s);
  const closed = monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 100.5, 103.4, 99.9, 101)] }, E + 2 * H);
  assert(closed[0].exitReason === 'breakeven_stop' && closed[0].legs.some(l => l.reason === 'tp1'));
});
test('gap through the stop fills at the (worse) open price', () => {
  const s = fresh(); openOne(s);
  const closed = monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 95, 96, 94, 95.5)] }, E + 2 * H);
  approx(closed[0].exitPrice, 95 * (1 - 2 / 1e4), 1e-9);
});
test('SHORT: mirrored stop above entry, targets below', () => {
  const s = fresh();
  const d = decision({ id: 'BTC:1H:2:short', decision: 'SHORT', engineDecision: 'SELL', stopLoss: 102, tp1: 97, tp2: 94, tp3: 91 });
  processDecision(s, d, ctx(s)); const p = s.positions[0];
  assert(p.direction === 'short' && p.entryPrice < 100);
  const win = monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 99.8, 100, 90.5, 91), ] }, E + 2 * H);
  assert(win[0].outcome === 'win' && win[0].exitReason === 'tp3' && win[0].grossPnl > 0);
  ledger(s);
  const s2 = fresh(); processDecision(s2, d, ctx(s2));
  const lose = monitorPositions(s2, { BTC: [bar(ENTRY_BAR + H, 100, 102.5, 99.9, 102)] }, E + 2 * H);
  assert(lose[0].outcome === 'loss' && lose[0].grossPnl < 0);
});
test('the FORMING candle is never used, and bars that closed before entry are ignored', () => {
  const s = fresh(); openOne(s);
  const forming = bar(ENTRY_BAR + H, 100, 100.5, 90, 91);                      // would hit the stop…
  assert(monitorPositions(s, { BTC: [bar(ENTRY_BAR - H, 100, 100, 50, 60), forming] }, ENTRY_BAR + H + 1800).length === 0);   // …but it has not closed yet
  assert(s.positions.length === 1);
  assert(monitorPositions(s, { BTC: [forming] }, ENTRY_BAR + 2 * H + 1).length === 1);                                       // now it has
});
test('the entry candle is trusted only from entry → close (an earlier wick cannot stop us out)', () => {
  const s = fresh(); openOne(s);
  const closed = monitorPositions(s, { BTC: [bar(ENTRY_BAR, 100, 100.5, 95, 100.4)] }, ENTRY_BAR + H + 1);
  assert(closed.length === 0 && s.positions.length === 1);
});
test('monitoring is idempotent: re-processing the same candles never double-fills', () => {
  const s = fresh(); openOne(s);
  const bars = [bar(ENTRY_BAR + H, 100.1, 103.5, 100.2, 103.1)];
  monitorPositions(s, { BTC: bars }, E + 2 * H);
  const snap = JSON.stringify(s.positions);
  monitorPositions(s, { BTC: bars }, E + 2 * H); monitorPositions(s, { BTC: bars }, E + 2 * H);
  assert(JSON.stringify(s.positions) === snap); ledger(s);
});

// ════════════════════════════════════════════════════════════════
section('Emergency STOP');
test('STOP (freeze): blocks new orders immediately, clears approvals, turns agent OFF, keeps managing open positions', () => {
  const s = fresh({ mode: 'approval' });
  s.pending.push({ id: 'p', decision: decision({ id: 'q' }), createdAt: E, expiresAt: E + 900 });
  const s2 = fresh(); openOne(s2);
  emergencyStop(s, { BTC: 100 }, E);
  assert(s.settings.emergencyStopped && !s.settings.agentOn && s.pending.length === 0);
  assert(processDecision(s, decision({ id: 'z' }), ctx(s)) === 'rejected_risk' && s.positions.length === 0);
  emergencyStop(s2, { BTC: 100 }, E);
  assert(s2.positions.length === 1);
  const closed = monitorPositions(s2, { BTC: [bar(ENTRY_BAR + H, 99, 99, 97, 97.5)] }, E + 2 * H);
  assert(closed.length === 1 && closed[0].exitReason === 'stop');       // protective stop still works after STOP
});
test('STOP (flatten): closes every open position at market, reason recorded', () => {
  const s = fresh({ emergencyPolicy: 'flatten' }); openOne(s);
  emergencyStop(s, { BTC: 101 }, E + 60);
  assert(s.positions.length === 0 && s.trades.length === 1 && s.trades[0].exitReason === 'emergency_flatten');
  ledger(s);
});
test('STOP (flatten) with no price keeps the protected position instead of guessing a price', () => {
  const s = fresh({ emergencyPolicy: 'flatten' }); openOne(s);
  emergencyStop(s, {}, E + 60);
  assert(s.positions.length === 1 && s.riskEvents.some(e => e.code === 'flatten_no_price'));
});
test('clearing STOP is explicit and leaves the agent OFF', () => {
  const s = fresh(); emergencyStop(s, {}, E); clearEmergencyStop(s, E + 1);
  assert(!s.settings.emergencyStopped && !s.settings.agentOn);
});

// ════════════════════════════════════════════════════════════════
section('Approval mode & live-trading lock');
test('approval mode queues the trade (no position) and expires', () => {
  const s = fresh({ mode: 'approval' });
  assert(processDecision(s, decision(), ctx(s)) === 'pending_approval' && s.positions.length === 0 && s.pending.length === 1);
  expirePending(s, E + 10 * 3600);
  assert(s.pending.length === 0 && s.decisions[s.decisions.length - 1]!.outcome === 'expired');
});
test('approve re-runs the FULL risk gate with current price/feed, then executes as PAPER', () => {
  const s = fresh({ mode: 'approval' }); processDecision(s, decision(), ctx(s));
  const r = approvePending(s, s.pending[0].id, { ...ctx(s), nowSec: E + 60, feed: 'fresh' });
  assert(r.ok && s.positions.length === 1 && s.decisions[s.decisions.length - 1]!.outcome === 'approved');
});
test('approval cannot bypass the gate: stale feed / emergency stop / price moved ⇒ rejected', () => {
  const a = fresh({ mode: 'approval' }); processDecision(a, decision(), ctx(a));
  assert(!approvePending(a, a.pending[0].id, { ...ctx(a), feed: 'stale' }).ok && a.positions.length === 0);
  const b = fresh({ mode: 'approval' }); processDecision(b, decision(), ctx(b)); b.settings.emergencyStopped = true;
  assert(!approvePending(b, b.pending[0].id, ctx(b)).ok && b.positions.length === 0);
  const c = fresh({ mode: 'approval' }); processDecision(c, decision(), ctx(c));
  assert(!approvePending(c, c.pending[0].id, ctx(c, 104)).ok && c.positions.length === 0);
});
test('decline removes the order; unknown ids are harmless', () => {
  const s = fresh({ mode: 'approval' }); processDecision(s, decision(), ctx(s));
  declinePending(s, 'nope', E); assert(s.pending.length === 1);
  declinePending(s, s.pending[0].id, E); assert(s.pending.length === 0 && s.decisions[s.decisions.length - 1]!.outcome === 'declined');
});
test('LIVE trading is locked: unavailable flag, forced back to paper on create/hydrate, gate and executor refuse', () => {
  assert(LIVE_TRADING_AVAILABLE === false);
  assert(createInitialState({ mode: 'live' }).settings.mode === 'paper');
  const raw = JSON.parse(JSON.stringify(createInitialState())); raw.settings.mode = 'live';
  assert(hydrateState(raw).settings.mode === 'paper');
  const s = fresh(); s.settings.mode = 'live';
  assert(!evaluateRisk(s, decision(), ctx(s)).approved);
  assert(!openPaperPosition(s, decision(), { approved: true, checks: [], qty: 1, riskUsd: 1, notionalUsd: 100, leverage: 0.01, sizeNote: null }, 100, E).ok);
  assert(processDecision(s, decision(), ctx(s)) === 'rejected_risk' && s.positions.length === 0);
});

// ════════════════════════════════════════════════════════════════
section('Trade-history statistics (hand-computed)');
const T = [fakeTrade(100, 1_700_000_100), fakeTrade(-50, 1_700_000_200), fakeTrade(30, 1_700_000_300), fakeTrade(-20, 1_700_000_400), fakeTrade(0, 1_700_000_500)];
test('win rate, total P&L, avg win/loss, profit factor, drawdown', () => {
  const st = computeStats(T, 1000);
  assert(st.totalTrades === 5 && st.wins === 2 && st.losses === 2 && st.breakeven === 1);
  approx(st.winRate!, 40); approx(st.totalPnl, 60); approx(st.avgWin!, 65); approx(st.avgLoss!, -35);
  approx(st.profitFactor!, 130 / 70, 1e-9); approx(st.maxDrawdown, 50); approx(st.maxDrawdownPct, 50 / 1100 * 100, 1e-9);
  approx(st.expectancy!, 12); assert(st.best === 100 && st.worst === -50);
});
test('equity curve = start + cumulative net P&L in exit order', () => {
  const c = equityCurve([T[2], T[0], T[1]], 1000).map(p => p.equity);
  assert(JSON.stringify(c) === JSON.stringify([1100, 1050, 1080]));
});
test('no trades ⇒ nulls, not zeros or infinities; no losses ⇒ profit factor undefined', () => {
  const e = computeStats([], 1000);
  assert(e.winRate === null && e.profitFactor === null && e.avgWin === null && e.avgLoss === null && e.totalPnl === 0);
  assert(computeStats([fakeTrade(10, 1)], 1000).profitFactor === null);
});
test('daily / weekly / monthly breakdowns (UTC, Monday weeks)', () => {
  const d = (iso: string) => Date.parse(iso) / 1000;
  const tr = [fakeTrade(10, d('2026-01-05T10:00:00Z')), fakeTrade(-4, d('2026-01-07T10:00:00Z')), fakeTrade(6, d('2026-01-12T10:00:00Z')), fakeTrade(5, d('2026-02-01T00:00:00Z'))];
  const day = periodBreakdown(tr, 'day'), week = periodBreakdown(tr, 'week'), month = periodBreakdown(tr, 'month');
  assert(day.length === 4 && week.length === 3 && month.length === 2);
  assert(week[0].key === '2026-01-05' && week[0].pnl === 6 && week[0].trades === 2 && week[1].key === '2026-01-12');
  assert(month[0].key === '2026-01' && month[0].pnl === 12 && month[1].key === '2026-02');
});
test('paper and live records are never mixed', () => {
  const live = { ...fakeTrade(999, 1_700_000_999), accountType: 'live' } as unknown as TradeRecord;
  const mixed = [...T, live];
  assert(filterByAccount(mixed, 'paper').length === 5 && filterByAccount(mixed, 'live').length === 1);
  approx(computeStats(filterByAccount(mixed, 'paper'), 1000).totalPnl, 60);
  const s = createInitialState(); const raw = JSON.parse(JSON.stringify(s)); raw.trades = [fakeTrade(1, 1), live];
  assert(hydrateState(raw).trades.length === 1);       // a live record can never be loaded into the paper account
});
test('every paper trade carries the required history fields, tagged simulated', () => {
  const s = fresh(); openOne(s);
  const [t] = monitorPositions(s, { BTC: [bar(ENTRY_BAR + H, 99, 99, 97, 97.5)] }, E + 2 * H);
  for (const k of ['id', 'symbol', 'category', 'direction', 'entryPrice', 'exitPrice', 'stopLoss', 'takeProfit', 'qty', 'leverage', 'entryTime', 'exitTime', 'realizedPnl', 'fees', 'outcome', 'strategy', 'timeframe', 'reasoning', 'executionStatus'] as const) {
    assert((t as never)[k] !== undefined && (t as never)[k] !== null, k);
  }
  assert(t.accountType === 'paper' && t.executionStatus === 'filled_paper' && t.exitTime > t.entryTime);
});

// ════════════════════════════════════════════════════════════════
section('Persistence & restart recovery');
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
test('save → load round-trips; open positions, history and idempotency keys survive a restart', () => {
  const s = fresh(); openOne(s); s.trades.push(fakeTrade(10, E - 5000)); s.account.balance += 10; s.account.peakEquity = s.account.balance;
  const st = memStore(); assert(saveState(st, s));
  const r = loadState(st);
  assert(JSON.stringify(r) === JSON.stringify(s));
  assert(processDecision(r, decision(), ctx(r)) === 'duplicate');
  const closed = monitorPositions(r, { BTC: [bar(ENTRY_BAR + H, 99, 99, 97, 97.5)] }, E + 2 * H);
  assert(closed.length === 1); ledger(r);
});
test('restart mid-ladder does not re-fill TP1 (tpHit/lastBarTime persisted)', () => {
  const s = fresh(); openOne(s);
  const bars = [bar(ENTRY_BAR + H, 100.1, 103.5, 100.2, 103.1)];
  monitorPositions(s, { BTC: bars }, E + 2 * H);
  const st = memStore(); saveState(st, s); const r = loadState(st);
  monitorPositions(r, { BTC: bars }, E + 2 * H);
  assert(r.positions[0].legs.filter(l => l.reason === 'tp1').length === 1); ledger(r);
});
test('corrupt / foreign storage falls back to a fresh PAPER account without throwing', () => {
  const st = memStore(); st.setItem(PAPER_STORAGE_KEY, '{not json');
  assert(loadState(st).settings.mode === 'paper' && loadState(st).trades.length === 0);
  assert(hydrateState({ version: 99 }).trades.length === 0 && hydrateState(null).settings.mode === 'paper');
  const bad = JSON.parse(JSON.stringify(fresh())); bad.settings.risk.riskPerTradePct = 90;
  assert(hydrateState(bad).settings.risk.riskPerTradePct === 2);
});
test('storage failure is reported, not thrown', () => {
  assert(saveState({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, fresh()) === false);
});
test('reset clears history but keeps settings and leaves the agent OFF', () => {
  const s = fresh({ timeframe: '4H' }); openOne(s); s.trades.push(fakeTrade(5, 1));
  const r = resetPaperAccount(s);
  assert(r.trades.length === 0 && r.positions.length === 0 && r.settings.timeframe === '4H' && !r.settings.agentOn && r.account.balance === r.account.startingEquity);
});
test('worker state file: atomic write, round-trip, corrupt file recovered (backup kept)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aizen-')); const f = join(dir, 'state.json');
  const s = fresh(); openOne(s);
  saveStateFile(f, s); assert(!existsSync(f + '.tmp'));
  assert(JSON.stringify(loadStateFile(f)) === JSON.stringify(s));
  writeFileSync(f, '{broken');
  assert(loadStateFile(f).trades.length === 0 && existsSync(f + '.corrupt') && readFileSync(f + '.corrupt', 'utf8') === '{broken');
  assert(loadStateFile(join(dir, 'missing.json')).settings.mode === 'paper');
});
test('browser: only one tab owns the agent; a stale lock can be taken over; release frees it', () => {
  const st = memStore();
  assert(claimLock(st, 'A', 1_000));
  assert(!claimLock(st, 'B', 2_000));                        // A holds it
  assert(claimLock(st, 'A', 40_000));                        // A refreshes
  assert(!claimLock(st, 'B', 40_000 + LOCK_TTL_MS - 1));     // still fresh
  assert(claimLock(st, 'B', 40_000 + LOCK_TTL_MS + 1));      // A went silent ⇒ B takes over
  assert(!claimLock(st, 'A', 40_000 + LOCK_TTL_MS + 2));
  releaseLock(st, 'A'); assert(!claimLock(st, 'A', 40_000 + LOCK_TTL_MS + 3));   // not A's lock ⇒ no-op
  releaseLock(st, 'B'); assert(claimLock(st, 'A', 40_000 + LOCK_TTL_MS + 4));
  st.setItem(LOCK_KEY, '{garbage'); assert(claimLock(st, 'C', 1));               // corrupt lock never deadlocks
});
test('browser: history is capped so localStorage cannot grow without bound', () => {
  const s = fresh();
  for (let i = 0; i < 400; i++) processDecision(s, decision({ decision: 'NO TRADE', id: `n${i}` }), ctx(s));
  assert(s.decisions.length === 150);
  assert(JSON.stringify(s).length < 1_000_000, `state ${JSON.stringify(s).length} bytes`);
});
test('worker: one worker per state file; dead owner is replaced; release only by owner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aizen-lock-')); const f = join(dir, 's.json');
  assert(acquireWorkerLock(f, 111, () => true));
  assert(!acquireWorkerLock(f, 222, () => true));            // 111 is alive
  assert(acquireWorkerLock(f, 222, () => false));            // 111 is dead ⇒ take over
  releaseWorkerLock(f, 111); assert(existsSync(`${f}.lock`)); // not the owner
  releaseWorkerLock(f, 222); assert(!existsSync(`${f}.lock`));
  assert(acquireWorkerLock(f, 333, () => true));
});

// ════════════════════════════════════════════════════════════════
section('TradeXLive analysis → Aizen decision');
const series = (seed: number, vol: number) => randomWalk(300, seed, 100, vol);
const NOW = (c: Candle[], tf = H) => c[c.length - 1].time + tf;
function analyse(c: Candle[], feed: 'fresh' | 'stale' = 'fresh', news = NEWS_OK) {
  return runAnalysis(c, 'BTC/USDT', '1H', { kind: 'crypto', decimals: 2, feed, news, nowSec: NOW(c) });
}
const BTC = ASSET_CONFIGS.find(a => a.id === 'BTC')!;
test('engine BUY → LONG with the engine\'s own plan numbers (nothing invented)', () => {
  const c = series(89, 1); const a = analyse(c)!;
  assert(a.decision === 'BUY' && !!a.tradeSetup, `engine says ${a.decision}`);
  const d = buildDecision(a, BTC, '1H', 'fresh', NOW(c));
  assert(d.decision === 'LONG' && d.entry === a.tradeSetup!.entry && d.stopLoss === a.tradeSetup!.stopLoss);
  assert(d.tp1 === a.tradeSetup!.tp1 && d.tp2 === a.tradeSetup!.tp2 && d.tp3 === a.tradeSetup!.tp3 && d.asOf === a.asOf);
  assert(d.id === `BTC:1H:${a.asOf}:long`);
});
test('engine SELL → SHORT', () => {
  const c = series(22, 1); const a = analyse(c)!;
  assert(a.decision === 'SELL', `engine says ${a.decision}`);
  const d = buildDecision(a, BTC, '1H', 'fresh', NOW(c));
  assert(d.decision === 'SHORT' && d.stopLoss! > d.entry!);
});
test('reasoning is built from real analysis values only (no NaN / undefined / null text)', () => {
  const c = series(89, 1); const a = analyse(c)!;
  const text = buildDecision(a, BTC, '1H', 'fresh', NOW(c)).reasoning.join('\n');
  assert(!/NaN|undefined|null|Infinity/.test(text), text);
  if (a.indicators.rsi !== null) assert(text.includes(`RSI ${a.indicators.rsi.toFixed(1)}`));
  assert(text.includes('Structure') && text.includes('safety gates'));
});
test('too little data → NO TRADE (data unavailable), never a guess', () => {
  const c = series(89, 1).slice(0, 30); const a = runAnalysis(c, 'BTC/USDT', '1H', { kind: 'crypto', nowSec: NOW(c), feed: 'fresh', news: NEWS_OK });
  const d = buildDecision(a, BTC, '1H', 'fresh', NOW(c));
  assert(d.decision === 'NO TRADE' && d.entry === null && d.reasoning[0].includes('DATA UNAVAILABLE'));
  assert(buildDecision(null, BTC, '1H', 'fresh', 1).decision === 'NO TRADE');
});
test('stale feed: the existing engine gate blocks the trade → no LONG/SHORT', () => {
  const c = series(89, 1); const a = analyse(c, 'stale')!;
  const d = buildDecision(a, BTC, '1H', 'stale', NOW(c));
  assert(d.decision !== 'LONG' && d.decision !== 'SHORT');
});
test('WAIT is preserved as WAIT', () => {
  let found = false;
  for (let seed = 1; seed < 40 && !found; seed++) {
    const c = series(seed, 1); const a = analyse(c)!;
    if (a.decision === 'WAIT') { found = true; assert(buildDecision(a, BTC, '1H', 'fresh', NOW(c)).decision === 'WAIT'); }
  }
  assert(found, 'no WAIT sample found');
});
test('feed freshness: newest candle within two bar-lengths is fresh, older is stale', () => {
  const c = series(5, 1);
  assert(feedFreshness(c, '1H', c[c.length - 1].time + 3000) === 'fresh');
  assert(feedFreshness(c, '1H', c[c.length - 1].time + 2 * H + 1) === 'stale' && feedFreshness([], '1H', 1) === 'stale');
});

// ════════════════════════════════════════════════════════════════
section('Autonomous paper-trading cycle (end-to-end with injected data sources)');
function deps(map: { [id: string]: Candle[] | Error }, news: NewsRiskDetail = NEWS_OK): AgentDeps & { calls: number } {
  const d = {
    calls: 0,
    async loadBars(id: string) { d.calls++; const v = map[id]; if (!v) throw new Error('no feed'); if (v instanceof Error) throw v; return v; },
    async loadContext() { return { middle: null, higher: null, higherTf: null }; },
    newsFor() { return news; },
  };
  return d as unknown as AgentDeps & { calls: number };
}
const cycleState = (assets: string[] = ['BTC']) => createInitialState({ agentOn: true, assets: assets as never, markets: { crypto: true, forex: false, gold: false } });

test('LONG cycle: data → analysis → decision → risk gate → PAPER position; second cycle on the same bar does nothing', async () => {
  const c = series(89, 1), now = NOW(c) * 1000; const s = cycleState();
  const r = await runCycle(s, deps({ BTC: c }), now);
  assert(r.errors.length === 0 && s.positions.length === 1 && s.positions[0].direction === 'long', JSON.stringify(s.decisions.map(d => [d.decision.decision, d.outcome, d.rejectReasons])));
  const p = s.positions[0];
  assert(p.stop < p.entryPrice && p.tp1 > p.entryPrice && p.riskUsd > 0 && p.riskUsd <= 50.0001 && p.reasoning.length > 3);
  assert(s.decisions[s.decisions.length - 1]!.outcome === 'executed_paper' && s.heartbeat.cycles === 1 && s.heartbeat.lastCycleAt === NOW(c));
  const before = JSON.stringify(s.positions); const dec = s.decisions.length;
  const d2 = deps({ BTC: c });
  await runCycle(s, d2, now + 30_000);
  assert(JSON.stringify(s.positions) === before && s.decisions.length === dec && s.trades.length === 0);
  ledger(s);
});
test('SHORT cycle', async () => {
  const c = series(22, 1); const s = cycleState();
  await runCycle(s, deps({ BTC: c }), NOW(c) * 1000);
  assert(s.positions.length === 1 && s.positions[0].direction === 'short', JSON.stringify(s.decisions.map(d => [d.decision.decision, d.outcome, d.rejectReasons])));
});
test('full lifecycle: cycle opens → later candles hit the stop → trade saved in history, ledger consistent', async () => {
  const c = series(89, 1), now = NOW(c); const s = cycleState();
  await runCycle(s, deps({ BTC: c }), now * 1000);
  const p = s.positions[0]; const last = c[c.length - 1];
  const crash = [...c, bar(last.time + H, last.close, last.close, p.stop - 5, p.stop - 4), bar(last.time + 2 * H, p.stop - 4, p.stop - 3, p.stop - 6, p.stop - 5)];
  const r = await runCycle(s, deps({ BTC: crash }), (now + 3 * H) * 1000);
  assert(r.closed.length === 1 && s.positions.length === 0 && s.trades.length === 1 && s.trades[0].outcome === 'loss');
  ledger(s);
});
test('agent OFF: no analysis / no new trades, but open positions are still managed', async () => {
  const c = series(89, 1), now = NOW(c); const s = cycleState();
  await runCycle(s, deps({ BTC: c }), now * 1000);
  const p = s.positions[0]; const last = c[c.length - 1];
  s.settings.agentOn = false;
  const crash = [...c, bar(last.time + H, last.close, last.close, p.stop - 5, p.stop - 4)];
  const d = deps({ BTC: crash });
  const r = await runCycle(s, d, (now + 2 * H) * 1000);
  assert(r.closed.length === 1 && r.analysed.length === 0 && s.positions.length === 0);
  const idle = cycleState(); idle.settings.agentOn = false;
  const d2 = deps({ BTC: c }); await runCycle(idle, d2, now * 1000);
  assert(d2.calls === 0 && idle.positions.length === 0 && idle.decisions.length === 0);
});
test('STALE market data: nothing is traded, the bar is NOT burned, and it trades once the feed recovers', async () => {
  const c = series(89, 1); const s = cycleState();
  await runCycle(s, deps({ BTC: c }), (NOW(c) + 6 * H) * 1000);            // newest candle is 7 bars old
  assert(s.positions.length === 0 && s.decisions.length === 0 && s.riskEvents.some(e => e.code === 'stale_data') && Object.keys(s.lastAnalyzedBar).length === 0);
  await runCycle(s, deps({ BTC: c }), NOW(c) * 1000);                       // feed is current again
  assert(s.positions.length === 1);
});
test('DISCONNECTED feed: error reported, risk event logged, no trade, no crash; healthy assets still processed', async () => {
  const c = series(89, 1); const s = cycleState(['BTC', 'ETH']);
  const r = await runCycle(s, deps({ BTC: new Error('ECONNRESET'), ETH: series(7, 1) }), NOW(c) * 1000);
  assert(r.errors.length === 1 && r.errors[0].includes('BTC') && s.heartbeat.lastError!.includes('ECONNRESET') === true);
  assert(s.riskEvents.some(e => e.code === 'data_unavailable') && !s.positions.some(p => p.assetId === 'BTC'));
  assert(s.decisions.some(d => d.decision.assetId === 'ETH'));
  const again = s.riskEvents.length; await runCycle(s, deps({ BTC: new Error('ECONNRESET'), ETH: series(7, 1) }), NOW(c) * 1000 + 30_000);
  assert(s.riskEvents.length === again, 'repeated outages must not spam risk events');
});
test('empty candle series is treated as unavailable', async () => {
  const s = cycleState(); const r = await runCycle(s, deps({ BTC: [] }), 1_700_000_000_000);
  assert(r.errors.length === 1 && s.positions.length === 0 && s.decisions.length === 0);
});
test('no news/calendar coverage: the agent waits (no decision, bar not burned) and trades once coverage arrives', async () => {
  const c = series(89, 1);
  const s = cycleState(); await runCycle(s, deps({ BTC: c }, { level: 'unknown', phase: null, drivers: [], coverage: 'none' }), NOW(c) * 1000);
  assert(s.positions.length === 0 && s.decisions.length === 0 && s.riskEvents.some(e => e.code === 'news_unavailable') && Object.keys(s.lastAnalyzedBar).length === 0);
  await runCycle(s, deps({ BTC: c }), NOW(c) * 1000 + 30_000);
  assert(s.positions.length === 1);
  const off = cycleState(); off.settings.risk.requireNewsCoverage = false;       // explicit opt-out
  await runCycle(off, deps({ BTC: c }, { level: 'unknown', phase: null, drivers: [], coverage: 'none' }), NOW(c) * 1000);
  assert(off.decisions.length === 1);
});
test('HIGH news risk is blocked by the existing engine gate', async () => {
  const c = series(89, 1);
  const s = cycleState(); await runCycle(s, deps({ BTC: c }, { level: 'high', phase: 'BEFORE', drivers: ['USD CPI in 10 min'], coverage: 'calendar' }), NOW(c) * 1000);
  assert(s.positions.length === 0);
});
test('emergency stop halts the cycle from opening anything', async () => {
  const c = series(89, 1); const s = cycleState(); emergencyStop(s, {}, 1);
  s.settings.agentOn = true;                                                      // even if something flipped it back on
  const d = deps({ BTC: c }); await runCycle(s, d, NOW(c) * 1000);
  assert(s.positions.length === 0 && d.calls === 0);
});
test('approval mode in the cycle: queued, then approval executes after re-validation', async () => {
  const c = series(89, 1); const s = cycleState(); s.settings.mode = 'approval';
  await runCycle(s, deps({ BTC: c }), NOW(c) * 1000);
  assert(s.positions.length === 0 && s.pending.length === 1);
  const px = await latestPrice(deps({ BTC: c }), 'BTC', '1H', NOW(c) * 1000);
  assert(px !== null && px.feed === 'fresh');
  const r = approvePending(s, s.pending[0].id, { nowSec: NOW(c) + 30, prices: { BTC: px!.price }, livePrice: px!.price, spreadBps: null, feed: px!.feed });
  assert(r.ok && s.positions.length === 1);
  assert(await latestPrice(deps({ BTC: new Error('down') }), 'BTC', '1H', 1) === null);
});
test('one position per asset and max-open-positions hold across many cycles (no duplicate stacking)', async () => {
  const c = series(89, 1); const s = cycleState(); s.settings.risk.maxOpenPositions = 1;
  for (let i = 0; i < 5; i++) await runCycle(s, deps({ BTC: c }), NOW(c) * 1000 + i * 30_000);
  assert(s.positions.length === 1 && s.seenOrderKeys.length === 1);
});
test('TF constants used by the agent match the project', () => { assert(TF_SECONDS['1H' as Timeframe] === 3600); });

// ════════════════════════════════════════════════════════════════
section('Risk status (dashboard)');
test('status mirrors the gate: ok on a fresh account, blocked when any limit trips', () => {
  const s = fresh(); const ok = riskStatus(s, { BTC: 100 }, E);
  assert(ok.level === 'ok' && ok.equity === 10_000 && ok.items.every(i => !i.tripped));
  s.trades.push(fakeTrade(-250, E - 600)); s.account.balance -= 250;
  const bad = riskStatus(s, { BTC: 100 }, E);
  assert(bad.level === 'blocked' && bad.items.find(i => i.name === 'Daily loss')!.tripped);
  assert(riskStatus(fresh({ emergencyStopped: true }), {}, E).level === 'blocked');
});
test('status counts unrealised P&L of open positions in equity and exposure', () => {
  const s = fresh(); const p = openOne(s);
  const st = riskStatus(s, { BTC: 102 }, E);
  approx(st.unrealized, p.qty * (102 - p.entryPrice), 1e-6); assert(st.exposurePct > 0 && st.items.find(i => i.name === 'Open positions')!.value === '1');
});

done();
