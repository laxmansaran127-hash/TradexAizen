import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import type { AizenAgent } from '@/hooks/useAizenAgent';
import { ASSET_CONFIGS } from '@/types/trading';
import { evaluateRisk } from '@/lib/aizen/risk';
import { unrealizedPnl } from '@/lib/aizen/accounting';
import { money, pnlColor, price, when } from '@/lib/aizen/format';
import { classNames } from '@/lib/format';

const dec = (id: string) => ASSET_CONFIGS.find(a => a.id === id)?.decimals ?? 2;

const OUTCOME_STYLE: { [k: string]: string } = {
  executed_paper: 'bg-emerald-500/15 text-emerald-300', approved: 'bg-emerald-500/15 text-emerald-300',
  pending_approval: 'bg-sky-500/15 text-sky-300', rejected_risk: 'bg-red-500/15 text-red-300',
  no_trade: 'bg-slate-700/50 text-slate-400', duplicate: 'bg-amber-500/15 text-amber-300',
  expired: 'bg-slate-700/50 text-slate-400', declined: 'bg-slate-700/50 text-slate-400',
};

export function AizenKpis({ ag }: { ag: AizenAgent }) {
  const st = ag.status;
  const cells: [string, string, string][] = [
    ['Paper equity', money(st.equity), 'text-slate-100'],
    ['Cash balance', money(st.balance), 'text-slate-300'],
    ['Unrealised', money(st.unrealized, true), pnlColor(st.unrealized)],
    ['Daily P&L', money(st.dayPnl, true), pnlColor(st.dayPnl)],
    ['Drawdown', `${st.drawdownPct.toFixed(2)}%`, st.drawdownPct >= ag.state.settings.risk.maxDrawdownPct ? 'text-red-400' : 'text-slate-300'],
    ['Exposure', `${st.exposurePct.toFixed(0)}%`, 'text-slate-300'],
  ];
  return (
    <section className="grid grid-cols-2 md:grid-cols-6 gap-2">
      {cells.map(([l, v, c]) => (
        <div key={l} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p>
          <p className={classNames('text-lg font-bold tabular-nums', c)}>{v}</p>
        </div>
      ))}
      <div className="col-span-2 md:col-span-6 flex flex-wrap gap-1.5">
        {st.items.map(i => (
          <span key={i.name} className={classNames('px-2 py-1 rounded text-[11px] border', i.tripped ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-slate-800 text-slate-400')}>
            {i.name}: <b>{i.value}</b> / {i.limit}
          </span>
        ))}
      </div>
    </section>
  );
}

export function AizenPending({ ag }: { ag: AizenAgent }) {
  const s = ag.state;
  if (!s.pending.length) return null;
  return (
    <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-2">
      <h3 className="text-sm font-bold text-sky-300">Awaiting your approval ({s.pending.length})</h3>
      {s.pending.map(p => {
        const d = p.decision, k = dec(d.assetId);
        const v = evaluateRisk(s, d, { nowSec: ag.now, prices: ag.prices, livePrice: ag.prices[d.assetId] ?? null, spreadBps: null });
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs rounded-lg bg-slate-900/70 border border-slate-800 p-3">
            <b className="text-sm">{d.symbol}</b>
            <span className={d.decision === 'LONG' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{d.decision}</span>
            <span>Entry {price(d.entry, k)}</span><span>SL {price(d.stopLoss, k)}</span>
            <span>TP1/2/3 {price(d.tp1, k)} / {price(d.tp2, k)} / {price(d.tp3, k)}</span>
            <span>R:R {d.riskReward?.toFixed(2) ?? '—'}</span>
            <span>Size {v.qty > 0 ? `${v.qty} (risk ${money(v.riskUsd)})` : 'not allowed now'}</span>
            <span className="text-slate-500">expires in {Math.max(0, Math.round((p.expiresAt - ag.now) / 60))} min</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { void ag.approve(p.id); }} className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"><Check className="w-3 h-3" /> Approve (paper)</button>
              <button onClick={() => ag.decline(p.id)} className="flex items-center gap-1 px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800"><X className="w-3 h-3" /> Decline</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function AizenPositions({ ag }: { ag: AizenAgent }) {
  const rows = ag.state.positions;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-bold mb-2">Active paper positions <span className="text-slate-500 font-normal">(simulated)</span></h3>
      {!rows.length ? <p className="text-xs text-slate-500">No open positions.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-left"><tr>{['Asset', 'Side', 'Entry', 'Now', 'Stop', 'TP1 / TP2 / TP3', 'Size', 'Left', 'Unrealised', 'Booked', ''].map((h, i) => <th key={`${i}-${h}`} className="pr-3 py-1 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(p => {
                const k = dec(p.assetId), px = ag.prices[p.assetId], u = unrealizedPnl(p, px);
                return (
                  <tr key={p.id} className="border-t border-slate-800">
                    <td className="pr-3 py-1.5 font-semibold">{p.symbol}</td>
                    <td className={classNames('pr-3', p.direction === 'long' ? 'text-emerald-400' : 'text-red-400')}>{p.direction.toUpperCase()}</td>
                    <td className="pr-3 tabular-nums">{price(p.entryPrice, k)}</td><td className="pr-3 tabular-nums">{px ? price(px, k) : '—'}</td>
                    <td className="pr-3 tabular-nums">{price(p.stop, k)}{p.stop === p.entryPrice ? ' (BE)' : ''}</td>
                    <td className="pr-3 tabular-nums whitespace-nowrap">{price(p.tp1, k)} / {price(p.tp2, k)} / {price(p.tp3, k)} <span className="text-slate-500">hit {p.tpHit}</span></td>
                    <td className="pr-3 tabular-nums">{p.qty}</td><td className="pr-3 tabular-nums">{p.remainingQty}</td>
                    <td className={classNames('pr-3 tabular-nums', pnlColor(u))}>{px ? money(u, true) : '—'}</td>
                    <td className={classNames('pr-3 tabular-nums', pnlColor(p.realizedPnl))}>{money(p.realizedPnl, true)}</td>
                    <td><button onClick={() => { void ag.closePosition(p.id); }} className="px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800">Close</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AizenDecisions({ ag }: { ag: AizenAgent }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...ag.state.decisions].reverse().slice(0, 25);
  const log = [...ag.state.riskEvents].reverse().slice(0, 8);
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <h3 className="text-sm font-bold">Aizen decisions &amp; reasoning</h3>
      {!rows.length && <p className="text-xs text-slate-500">No decisions yet. Turn the agent ON — it analyses each newly closed candle once.</p>}
      <div className="space-y-1">
        {rows.map(r => {
          const d = r.decision, isOpen = open === r.id, k = dec(d.assetId);
          return (
            <div key={r.id} className="rounded-lg border border-slate-800">
              <button onClick={() => setOpen(isOpen ? null : r.id)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs">
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span className="text-slate-500 w-24">{when(r.time)}</span>
                <b className="w-20">{d.symbol}</b>
                <span className={classNames('font-bold w-16', d.decision === 'LONG' ? 'text-emerald-400' : d.decision === 'SHORT' ? 'text-red-400' : 'text-slate-400')}>{d.decision}</span>
                <span className={classNames('px-1.5 py-0.5 rounded text-[10px] font-semibold', OUTCOME_STYLE[r.outcome])}>{r.outcome.replace('_', ' ')}</span>
                <span className="text-slate-400 truncate flex-1 min-w-[10rem]">{r.rejectReasons[0] ?? d.engineReason}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 text-xs space-y-2 border-t border-slate-800 pt-2">
                  {d.decision === 'LONG' || d.decision === 'SHORT' ? (
                    <p className="tabular-nums">Entry {price(d.entry, k)} · SL {price(d.stopLoss, k)} · TP1 {price(d.tp1, k)} · TP2 {price(d.tp2, k)} · TP3 {price(d.tp3, k)} · R:R {d.riskReward?.toFixed(2)} · ATR {price(d.atr, k)}</p>
                  ) : null}
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-300">{d.reasoning.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  {r.rejectReasons.length > 0 && <div className="text-red-300"><p className="font-semibold">Risk layer rejected this:</p><ul className="list-disc pl-4">{r.rejectReasons.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
                  <p className="text-slate-500">Data: feed {d.feed}, news coverage {d.newsCoverage}. Candle used: {when(d.asOf)}.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {log.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Risk events</p>
          <ul className="space-y-0.5 text-[11px]">{log.map(e => <li key={e.id} className={e.level === 'block' ? 'text-red-300' : e.level === 'warn' ? 'text-amber-300' : 'text-slate-400'}>{when(e.time)} · {e.message}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
