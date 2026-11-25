import { Bot, Lock, OctagonX, Power, ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import type { AizenAgent } from '@/hooks/useAizenAgent';
import { ASSET_CONFIGS, type Timeframe } from '@/types/trading';
import type { MarketCategory } from '@/lib/aizen/types';
import { LIVE_TRADING_AVAILABLE } from '@/lib/aizen/types';
import { categoryOf } from '@/lib/aizen/instruments';
import { ago } from '@/lib/aizen/format';
import { classNames } from '@/lib/format';

const MARKETS: { id: MarketCategory; label: string }[] = [{ id: 'crypto', label: 'Crypto' }, { id: 'forex', label: 'Forex' }, { id: 'gold', label: 'Gold' }];
const TFS: Timeframe[] = ['15m', '30m', '1H', '4H'];

export function AizenControlPanel({ ag }: { ag: AizenAgent }) {
  const { state: s, status } = ag;
  const set = s.settings;
  const mode = set.mode;
  const ok = status.level === 'ok';

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-sky-600 flex items-center justify-center"><Bot className="w-5 h-5 text-white" /></div>
          <div>
            <h2 className="text-base font-bold leading-tight">Aizen AI <span className="text-slate-500">×</span> TradeXLive</h2>
            <p className="text-[11px] text-slate-500">Aizen decides · risk layer validates · paper engine simulates</p>
          </div>
        </div>
        <div className="flex-1" />
        <span className="px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">PAPER · SIMULATED · NO REAL MONEY</span>
        <span className="text-[10px] text-slate-500" title="Stored in this browser's localStorage. Clearing site data deletes it. The headless worker has a separate account.">browser paper account</span>
        <button
          onClick={() => ag.setAgentOn(!set.agentOn)}
          disabled={set.emergencyStopped}
          className={classNames('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-colors disabled:opacity-40',
            set.agentOn ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700')}
        >
          <Power className="w-4 h-4" /> Agent {set.agentOn ? 'ON' : 'OFF'}
        </button>
        <button onClick={() => { void ag.stop(); }} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white" title="Block all new orders immediately">
          <OctagonX className="w-4 h-4" /> EMERGENCY STOP
        </button>
      </div>

      {set.emergencyStopped && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <ShieldAlert className="w-4 h-4" /> Emergency STOP is active — no new orders. Open positions: {set.emergencyPolicy === 'flatten' ? 'closed at market' : 'kept, still protected by stop / targets'}.
          <button onClick={ag.clearStop} className="ml-auto px-3 py-1 rounded-md bg-slate-800 border border-slate-600 text-slate-200 text-xs font-semibold">Clear STOP (agent stays OFF)</button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Operating mode</p>
          <div className="flex gap-1.5 flex-wrap">
            {([['paper', 'Paper (auto)'], ['approval', 'Approval']] as const).map(([m, label]) => (
              <button key={m} onClick={() => ag.setMode(m)} className={classNames('px-3 py-1.5 rounded-md text-xs font-semibold border', mode === m ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'border-slate-700 text-slate-400 hover:bg-slate-800')}>{label}</button>
            ))}
            <button onClick={() => ag.setMode('live')} disabled={!LIVE_TRADING_AVAILABLE} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-800 text-slate-600 cursor-not-allowed" title="No broker/exchange execution connector is installed and live trading has not been authorised">
              <Lock className="w-3 h-3" /> Live auto — LOCKED
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{mode === 'approval' ? 'Aizen queues each trade; you approve it. Execution is still simulated.' : 'Aizen opens simulated trades automatically when every risk check passes.'}</p>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Markets (independent)</p>
          <div className="flex gap-1.5 flex-wrap">
            {MARKETS.map(m => (
              <button key={m.id} onClick={() => ag.toggleMarket(m.id)} className={classNames('px-3 py-1.5 rounded-md text-xs font-semibold border', set.markets[m.id] ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'border-slate-700 text-slate-500 hover:bg-slate-800')}>{m.label} {set.markets[m.id] ? 'ON' : 'OFF'}</button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {ASSET_CONFIGS.filter(a => set.markets[categoryOf(a.id)]).map(a => (
              <button key={a.id} onClick={() => ag.toggleAsset(a.id)} className={classNames('px-2 py-1 rounded text-[11px] font-mono border', set.assets.includes(a.id) ? 'bg-slate-700 text-slate-100 border-slate-500' : 'border-slate-800 text-slate-500 hover:bg-slate-800')}>{a.displaySymbol}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-2 text-slate-400">Timeframe
          <select value={set.timeframe} onChange={e => ag.setTimeframe(e.target.value as Timeframe)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200">
            {TFS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-400">On STOP, open positions
          <select value={set.emergencyPolicy} onChange={e => ag.setPolicy(e.target.value as 'freeze' | 'flatten')} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200">
            <option value="freeze">stay open (stops/targets keep working)</option>
            <option value="flatten">close at market</option>
          </select>
        </label>
        <span className={classNames('flex items-center gap-1.5 font-semibold', ok ? 'text-emerald-400' : 'text-red-400')}>{ok ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />} Risk {ok ? 'OK' : 'LIMIT REACHED'}</span>
        <span className="text-slate-500">Last cycle: {ago(s.heartbeat.lastCycleAt, ag.now)} · cycles {s.heartbeat.cycles}</span>
        <button onClick={() => { void ag.runNow(); }} disabled={ag.busy} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={classNames('w-3 h-3', ag.busy && 'animate-spin')} /> Run now</button>
      </div>

      {!ag.ownerTab && <p className="text-xs text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-3 py-2">Aizen is running in another tab/window. This tab mirrors the same paper account and will not start a second agent.</p>}
      {s.heartbeat.lastError && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">Data problem (trading is blocked for this asset): {s.heartbeat.lastError}</p>}
      {ag.notice && <p onClick={ag.dismissNotice} className="cursor-pointer text-xs text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-3 py-2">{ag.notice} <span className="text-slate-500">(click to dismiss)</span></p>}
      <p className="text-[11px] text-slate-500">
        The agent runs while this app is open. For 24/7 paper trading without a browser run <code className="text-slate-400">npm run aizen:worker</code> — the worker keeps its OWN paper account in a JSON file; it is never synchronised with this browser account. Forex &amp; gold need a Twelve Data / Finnhub key — without data the agent reports it and does not trade.
      </p>
    </section>
  );
}
