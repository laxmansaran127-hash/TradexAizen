import type { AizenState, PriceMap } from './types';
import { equityOf, openNotional, todayStats } from './accounting';

// ── Dashboard risk status (read-only view of the same numbers the risk gate uses) ──

export interface RiskStatusItem { name: string; value: string; limit: string; tripped: boolean }
export interface RiskStatus {
  level: 'ok' | 'blocked';
  equity: number; balance: number; unrealized: number;
  dayPnl: number; drawdownPct: number; exposurePct: number;
  items: RiskStatusItem[];
}

export function riskStatus(s: AizenState, prices: PriceMap, nowSec: number): RiskStatus {
  const r = s.settings.risk;
  const equity = equityOf(s, prices);
  const today = todayStats(s, nowSec);
  const dayStart = s.account.balance - today.realizedToday;
  const dayPnl = equity - dayStart;
  const peak = Math.max(s.account.peakEquity, equity);
  const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
  const exposurePct = equity > 0 ? openNotional(s, prices) / equity * 100 : 0;
  const lossLimit = dayStart * r.maxDailyLossPct / 100;
  const items: RiskStatusItem[] = [
    { name: 'Emergency STOP', value: s.settings.emergencyStopped ? 'ACTIVE' : 'off', limit: '—', tripped: s.settings.emergencyStopped },
    { name: 'Daily loss', value: `${dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(2)}`, limit: `-${lossLimit.toFixed(2)}`, tripped: dayPnl <= -lossLimit },
    { name: 'Drawdown from peak', value: `${dd.toFixed(2)}%`, limit: `${r.maxDrawdownPct}%`, tripped: dd >= r.maxDrawdownPct },
    { name: 'Consecutive losses today', value: String(today.consecutiveLossesToday), limit: String(r.maxConsecutiveLosses), tripped: today.consecutiveLossesToday >= r.maxConsecutiveLosses },
    { name: 'Trades today', value: String(today.tradesToday), limit: String(r.maxTradesPerDay), tripped: today.tradesToday >= r.maxTradesPerDay },
    { name: 'Open positions', value: String(s.positions.length), limit: String(r.maxOpenPositions), tripped: s.positions.length >= r.maxOpenPositions },
    { name: 'Exposure', value: `${exposurePct.toFixed(0)}%`, limit: `${r.maxTotalExposurePct}%`, tripped: exposurePct >= r.maxTotalExposurePct },
  ];
  return { level: items.some(i => i.tripped) ? 'blocked' : 'ok', equity, balance: s.account.balance, unrealized: equity - s.account.balance, dayPnl, drawdownPct: dd, exposurePct, items };
}
