import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AizenAgent } from '@/hooks/useAizenAgent';
import type { RiskSettings } from '@/lib/aizen/types';
import { HARD_LIMITS } from '@/lib/aizen/risk';

type NumKey = Exclude<keyof RiskSettings, 'requireNewsCoverage'>;
const FIELDS: { key: NumKey; label: string; hint: string; step: number }[] = [
  { key: 'riskPerTradePct', label: 'Risk per trade (% equity)', hint: `max ${HARD_LIMITS.riskPerTradePct}`, step: 0.05 },
  { key: 'maxDailyLossPct', label: 'Max daily loss (%)', hint: `max ${HARD_LIMITS.maxDailyLossPct}`, step: 0.5 },
  { key: 'maxDrawdownPct', label: 'Max drawdown from peak (%)', hint: `max ${HARD_LIMITS.maxDrawdownPct}`, step: 1 },
  { key: 'maxOpenPositions', label: 'Max open positions', hint: `max ${HARD_LIMITS.maxOpenPositions}`, step: 1 },
  { key: 'maxTradesPerDay', label: 'Max trades per day (UTC)', hint: `max ${HARD_LIMITS.maxTradesPerDay}`, step: 1 },
  { key: 'maxConsecutiveLosses', label: 'Max consecutive losses / day', hint: `max ${HARD_LIMITS.maxConsecutiveLosses}`, step: 1 },
  { key: 'minRewardToRisk', label: 'Min reward:risk (to TP2)', hint: 'min 1', step: 0.1 },
  { key: 'maxLeverage', label: 'Max leverage per position (×)', hint: `max ${HARD_LIMITS.maxLeverage}`, step: 0.5 },
  { key: 'maxTotalExposurePct', label: 'Max total exposure (% equity)', hint: `max ${HARD_LIMITS.maxTotalExposurePct}`, step: 10 },
  { key: 'maxEntryDriftAtr', label: 'Max entry drift (ATR)', hint: 'vs planned entry', step: 0.05 },
  { key: 'maxSpreadBps', label: 'Max spread (bps)', hint: 'assumed unless a quote feed exists', step: 0.5 },
  { key: 'startingEquity', label: 'Paper starting balance ($)', hint: 'editable before the first trade', step: 100 },
];

export function AizenRiskSettings({ ag }: { ag: AizenAgent }) {
  const [open, setOpen] = useState(false);
  const r = ag.state.settings.risk;
  const locked = ag.state.trades.length > 0 || ag.state.positions.length > 0;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-sm font-bold">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Risk settings <span className="text-xs font-normal text-slate-500">(values are clamped to hard limits; conservative defaults)</span></button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map(f => (
            <label key={f.key} className="text-xs text-slate-400 space-y-1">
              <span className="block">{f.label} <span className="text-slate-600">· {f.hint}</span></span>
              <input
                key={`${f.key}-${r[f.key]}`} type="number" step={f.step} defaultValue={r[f.key]}
                disabled={f.key === 'startingEquity' && locked}
                onBlur={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v !== r[f.key]) ag.updateRisk({ [f.key]: v }); }}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 disabled:opacity-40"
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs text-slate-300 sm:col-span-2">
            <input type="checkbox" checked={r.requireNewsCoverage} onChange={e => ag.updateRisk({ requireNewsCoverage: e.target.checked })} />
            Require news / economic-calendar coverage (refuse to trade blind). Recommended ON.
          </label>
        </div>
      )}
    </section>
  );
}
