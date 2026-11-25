import type { AccountType, TradeRecord } from './types';

// ── Trade-history statistics ────────────────────────────────────
// Computed only from stored trade records. Paper and live records are never mixed: callers must pick an
// account type via filterByAccount (there is no combined view).

export function filterByAccount(trades: TradeRecord[], type: AccountType): TradeRecord[] {
  return trades.filter(t => t.accountType === type);
}

export interface PerfStats {
  totalTrades: number; wins: number; losses: number; breakeven: number;
  /** null when there are no trades. */
  winRate: number | null;
  totalPnl: number; totalFees: number;
  grossProfit: number; grossLoss: number;
  avgWin: number | null; avgLoss: number | null;
  /** null when there are no losing trades (undefined, not infinite). */
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
  maxDrawdown: number; maxDrawdownPct: number;
  best: number | null; worst: number | null;
}

export interface EquityPoint { time: number; equity: number }

const byExit = (a: TradeRecord, b: TradeRecord) => a.exitTime - b.exitTime;

export function equityCurve(trades: TradeRecord[], startingEquity: number): EquityPoint[] {
  const out: EquityPoint[] = [];
  let eq = startingEquity;
  for (const t of [...trades].sort(byExit)) { eq += t.realizedPnl; out.push({ time: t.exitTime, equity: eq }); }
  return out;
}

export function computeStats(trades: TradeRecord[], startingEquity: number): PerfStats {
  const wins = trades.filter(t => t.outcome === 'win');
  const losses = trades.filter(t => t.outcome === 'loss');
  const grossProfit = wins.reduce((a, t) => a + t.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.realizedPnl, 0));
  const totalPnl = trades.reduce((a, t) => a + t.realizedPnl, 0);
  let peak = startingEquity, maxDD = 0, maxDDPct = 0;
  for (const p of equityCurve(trades, startingEquity)) {
    peak = Math.max(peak, p.equity);
    const dd = peak - p.equity;
    if (dd > maxDD) maxDD = dd;
    if (peak > 0 && dd / peak * 100 > maxDDPct) maxDDPct = dd / peak * 100;
  }
  const rs = trades.map(t => t.rMultiple).filter((v): v is number => typeof v === 'number');
  const n = trades.length;
  return {
    totalTrades: n, wins: wins.length, losses: losses.length, breakeven: n - wins.length - losses.length,
    winRate: n ? wins.length / n * 100 : null,
    totalPnl, totalFees: trades.reduce((a, t) => a + t.fees, 0), grossProfit, grossLoss,
    avgWin: wins.length ? grossProfit / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: n ? totalPnl / n : null,
    avgR: rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : null,
    maxDrawdown: maxDD, maxDrawdownPct: maxDDPct,
    best: n ? Math.max(...trades.map(t => t.realizedPnl)) : null,
    worst: n ? Math.min(...trades.map(t => t.realizedPnl)) : null,
  };
}

export interface PeriodRow { key: string; pnl: number; trades: number; wins: number }

/** UTC buckets by exit time. Weeks start Monday. */
export function periodBreakdown(trades: TradeRecord[], period: 'day' | 'week' | 'month'): PeriodRow[] {
  const map = new Map<string, PeriodRow>();
  for (const t of [...trades].sort(byExit)) {
    const d = new Date(t.exitTime * 1000);
    let key: string;
    if (period === 'month') key = d.toISOString().slice(0, 7);
    else if (period === 'day') key = d.toISOString().slice(0, 10);
    else {
      const dow = (d.getUTCDay() + 6) % 7;
      key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
    }
    const row = map.get(key) ?? { key, pnl: 0, trades: 0, wins: 0 };
    row.pnl += t.realizedPnl; row.trades++; if (t.outcome === 'win') row.wins++;
    map.set(key, row);
  }
  return [...map.values()];
}
