import type { AizenState, PriceMap, PaperPosition } from './types';
import { getSpec, notionalUsd, pnlUsd } from './instruments';

export const DAY = 86400;
export const utcDayStart = (sec: number): number => Math.floor(sec / DAY) * DAY;

export function unrealizedPnl(pos: PaperPosition, price: number | undefined): number {
  if (price === undefined || !Number.isFinite(price)) return 0;
  return pnlUsd(getSpec(pos.assetId), pos.direction === 'long' ? 1 : -1, pos.entryPrice, price, pos.remainingQty);
}

export function equityOf(state: AizenState, prices: PriceMap): number {
  return state.account.balance + state.positions.reduce((s, p) => s + unrealizedPnl(p, prices[p.assetId]), 0);
}

export function openNotional(state: AizenState, prices: PriceMap): number {
  return state.positions.reduce((s, p) => s + notionalUsd(getSpec(p.assetId), p.remainingQty, prices[p.assetId] ?? p.entryPrice), 0);
}

export interface TodayStats {
  realizedToday: number;
  tradesToday: number;
  consecutiveLossesToday: number;
}

/** Realised P&L is counted when cash is booked (every partial fill), not only when a trade fully closes. */
export function todayStats(state: AizenState, nowSec: number): TodayStats {
  const start = utcDayStart(nowSec);
  let realizedToday = 0;
  for (const t of state.trades) for (const l of t.legs) if (l.time >= start) realizedToday += l.pnl - l.fee;
  for (const p of state.positions) for (const l of p.legs) if (l.time >= start) realizedToday += l.pnl - l.fee;
  const closedToday = state.trades.filter(t => t.exitTime >= start).sort((a, b) => a.exitTime - b.exitTime);
  const openedToday = state.positions.filter(p => p.entryTime >= start).length;
  const tradesToday = state.trades.filter(t => t.entryTime >= start).length + openedToday;
  let consecutive = 0;
  for (let i = closedToday.length - 1; i >= 0; i--) { if (closedToday[i].outcome === 'loss') consecutive++; else break; }
  return { realizedToday, tradesToday, consecutiveLossesToday: consecutive };
}
