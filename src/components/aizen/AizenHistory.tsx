import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Trash2 } from 'lucide-react';
import type { AizenAgent } from '@/hooks/useAizenAgent';
import { ASSET_CONFIGS } from '@/types/trading';
import { computeStats, equityCurve, filterByAccount, periodBreakdown } from '@/lib/aizen/stats';
import { money, pct, pnlColor, price, tradesToCsv, when } from '@/lib/aizen/format';
import { classNames } from '@/lib/format';

const dec = (id: string) => ASSET_CONFIGS.find(a => a.id === id)?.decimals ?? 2;

function EquityCurve({ points, start }: { points: { time: number; equity: number }[]; start: number }) {
  if (points.length < 1) return <p className="text-xs text-slate-500">The equity curve appears after the first closed paper trade.</p>;
  const all = [{ time: points[0].time - 1, equity: start }, ...points];
  const W = 600, H = 150, P = 6;
  const lo = Math.min(...all.map(p => p.equity), start), hi = Math.max(...all.map(p => p.equity), start);
  const span = hi - lo || 1;
  const x = (i: number) => P + (i / Math.max(1, all.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  const last = all[all.length - 1].equity;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" role="img" aria-label="Paper equity curve">
      <line x1={P} x2={W - P} y1={y(start)} y2={y(start)} stroke="#475569" strokeDasharray="4 4" />
      <polyline fill="none" stroke={last >= start ? '#34d399' : '#f87171'} strokeWidth="2" points={all.map((p, i) => `${x(i)},${y(p.equity)}`).join(' ')} />
      <text x={W - P} y={12} textAnchor="end" fontSize="11" fill="#94a3b8">{money(last)} (start {money(start)})</text>
    </svg>
  );
}

export function AizenHistory({ ag }: { ag: AizenAgent }) {
  const s = ag.state;
  const paper = useMemo(() => filterByAccount(s.trades, 'paper'), [s.trades]);   // paper only — live records can never appear here
  const st = useMemo(() => computeStats(paper, s.account.startingEquity), [paper, s.account.startingEquity]);
  const curve = useMemo(() => equityCurve(paper, s.account.startingEquity), [paper, s.account.startingEquity]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const periods = useMemo(() => periodBreakdown(paper, period).reverse(), [paper, period]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rows = [...paper].sort((a, b) => b.exitTime - a.exitTime);
  const shown = all ? rows : rows.slice(0, 25);

  const exportCsv = () => {
    const csv = tradesToCsv(paper.map(t => ({
      account: 'PAPER (simulated)', trade_id: t.id, asset: t.symbol, market: t.category, direction: t.direction,
      entry_time: new Date(t.entryTime * 1000).toISOString(), exit_time: new Date(t.exitTime * 1000).toISOString(),
      entry_price: t.entryPrice, exit_price: t.exitPrice, stop_loss: t.stopLoss, tp1: t.takeProfit.tp1, tp2: t.takeProfit.tp2, tp3: t.takeProfit.tp3,
      qty: t.qty, leverage: t.leverage, gross_pnl: t.grossPnl, fees: t.fees, net_pnl: t.realizedPnl, r_multiple: t.rMultiple, outcome: t.outcome,
      exit_reason: t.exitReason, strategy: t.strategy, timeframe: t.timeframe, execution_status: t.executionStatus, reasoning: t.reasoning.join(' | '),
    })));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'aizen-paper-trades.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  const cards: [string, string, string][] = [
    ['Total trades', String(st.totalTrades), 'text-slate-100'],
    ['Win rate', pct(st.winRate), 'text-slate-100'],
    ['Total P&L', money(st.totalPnl, true), pnlColor(st.totalPnl)],
    ['Avg win', money(st.avgWin), 'text-emerald-400'],
    ['Avg loss', money(st.avgLoss), 'text-red-400'],
    ['Profit factor', st.profitFactor === null ? '—' : st.profitFactor.toFixed(2), 'text-slate-100'],
    ['Max drawdown', `${money(st.maxDrawdown)} (${st.maxDrawdownPct.toFixed(1)}%)`, 'text-slate-100'],
    ['Expectancy / trade', money(st.expectancy, true), pnlColor(st.expectancy)],
    ['Fees paid (assumed)', money(st.totalFees), 'text-slate-300'],
  ];

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">Aizen trade history</h3>
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">PAPER ACCOUNT — SIMULATED TRADES ONLY</span>
        <div className="flex-1" />
        <button onClick={exportCsv} disabled={!paper.length} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"><Download className="w-3 h-3" /> CSV</button>
        <button onClick={() => { if (window.confirm('Delete ALL paper trades and reset the paper balance? This cannot be undone.')) ag.reset(); }} className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="w-3 h-3" /> Reset paper account</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {cards.map(([l, v, c]) => (
          <div key={l} className="rounded-lg border border-slate-800 px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p><p className={classNames('text-sm font-bold tabular-nums', c)}>{v}</p></div>
        ))}
      </div>
      {st.totalTrades > 0 && st.totalTrades < 30 && <p className="text-[11px] text-amber-300/80">Only {st.totalTrades} trade(s): these statistics are not statistically meaningful yet, and simulated results do not guarantee live results.</p>}

      <EquityCurve points={curve} start={s.account.startingEquity} />

      <div>
        <div className="flex gap-1 mb-1">
          {(['day', 'week', 'month'] as const).map(p => <button key={p} onClick={() => setPeriod(p)} className={classNames('px-2 py-0.5 rounded text-xs border', period === p ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-400')}>{p === 'day' ? 'Daily' : p === 'week' ? 'Weekly' : 'Monthly'}</button>)}
        </div>
        {!periods.length ? <p className="text-xs text-slate-500">No closed trades yet.</p> : (
          <table className="text-xs w-full max-w-md"><tbody>
            {periods.slice(0, 12).map(r => <tr key={r.key} className="border-t border-slate-800"><td className="py-1 text-slate-400">{r.key}</td><td className="tabular-nums">{r.trades} trades</td><td className="tabular-nums">{r.wins} wins</td><td className={classNames('tabular-nums text-right', pnlColor(r.pnl))}>{money(r.pnl, true)}</td></tr>)}
          </tbody></table>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500 text-left"><tr>{['', 'Closed', 'Asset', 'Side', 'Entry', 'Exit', 'SL', 'TP1 / TP2 / TP3', 'Size', 'Fees', 'Net P&L', 'R', 'Result', 'Exit', 'Type'].map((h, i) => <th key={`${i}-${h}`} className="pr-3 py-1 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {shown.map(t => {
              const k = dec(t.assetId), isOpen = openId === t.id;
              return (
                <Fragment key={t.id}>
                  <tr className="border-t border-slate-800 cursor-pointer hover:bg-slate-800/40" onClick={() => setOpenId(isOpen ? null : t.id)}>
                    <td className="pr-1">{isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</td>
                    <td className="pr-3 py-1.5 whitespace-nowrap text-slate-400">{when(t.exitTime)}</td><td className="pr-3 font-semibold">{t.symbol}</td>
                    <td className={classNames('pr-3', t.direction === 'long' ? 'text-emerald-400' : 'text-red-400')}>{t.direction.toUpperCase()}</td>
                    <td className="pr-3 tabular-nums">{price(t.entryPrice, k)}</td><td className="pr-3 tabular-nums">{price(t.exitPrice, k)}</td><td className="pr-3 tabular-nums">{price(t.stopLoss, k)}</td>
                    <td className="pr-3 tabular-nums whitespace-nowrap">{price(t.takeProfit.tp1, k)} / {price(t.takeProfit.tp2, k)} / {price(t.takeProfit.tp3, k)}</td>
                    <td className="pr-3 tabular-nums">{t.qty}</td><td className="pr-3 tabular-nums">{money(t.fees)}</td>
                    <td className={classNames('pr-3 tabular-nums font-semibold', pnlColor(t.realizedPnl))}>{money(t.realizedPnl, true)}</td>
                    <td className="pr-3 tabular-nums">{t.rMultiple === null ? '—' : t.rMultiple.toFixed(2)}</td>
                    <td className={classNames('pr-3 font-semibold', t.outcome === 'win' ? 'text-emerald-400' : t.outcome === 'loss' ? 'text-red-400' : 'text-slate-400')}>{t.outcome.toUpperCase()}</td>
                    <td className="pr-3 text-slate-400">{t.exitReason.replace('_', ' ')}</td>
                    <td><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300">PAPER</span></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-950/60"><td colSpan={15} className="px-4 py-3 space-y-2">
                      <p className="text-slate-400">Opened {when(t.entryTime)} · {t.timeframe} · {t.strategy} · leverage {t.leverage.toFixed(2)}× · status {t.executionStatus} · gross {money(t.grossPnl, true)}</p>
                      <p className="text-slate-400">Fills: {t.legs.map(l => `${l.reason} ${l.qty} @ ${l.price.toFixed(k)}`).join(' · ')}</p>
                      <ul className="list-disc pl-4 text-slate-300 space-y-0.5">{t.reasoning.map((l, i) => <li key={i}>{l}</li>)}</ul>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="text-xs text-slate-500 py-2">No paper trades yet.</p>}
        {rows.length > 25 && <button onClick={() => setAll(!all)} className="mt-2 text-xs text-sky-400">{all ? 'Show latest 25' : `Show all ${rows.length}`}</button>}
      </div>
    </section>
  );
}
