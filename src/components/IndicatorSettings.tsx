import { useState } from 'react';
import { Settings, X } from 'lucide-react';
import type { IndicatorParams } from '@/lib/indicatorConfig';
import { DEFAULT_PARAMS } from '@/lib/indicatorConfig';

interface IndicatorSettingsProps {
  params: IndicatorParams;
  onChange: (params: IndicatorParams) => void;
}

// Gear icon that opens a settings drawer for adjusting EMA periods and
// RSI threshold parameters. All other indicator params remain fixed.
export function IndicatorSettings({ params, onChange }: IndicatorSettingsProps) {
  const [open, setOpen] = useState(false);

  const update = (key: keyof IndicatorParams, value: number) => {
    if (isNaN(value) || value < 1) return;
    onChange({ ...params, [key]: value });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
        title="Indicator Settings"
      >
        <Settings className="w-3.5 h-3.5" />
        Indicators
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Indicator Settings</h3>
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">EMA Periods</p>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="EMA 1" value={params.ema1} onChange={v => update('ema1', v)} />
                <NumberInput label="EMA 2" value={params.ema2} onChange={v => update('ema2', v)} />
                <NumberInput label="EMA 3" value={params.ema3} onChange={v => update('ema3', v)} />
                <NumberInput label="EMA 4" value={params.ema4} onChange={v => update('ema4', v)} />
              </div>
            </div>

            <div className="h-px bg-slate-800" />

            <div>
              <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">RSI Threshold</p>
              <div className="grid grid-cols-3 gap-3">
                <NumberInput label="Period" value={params.rsiPeriod} onChange={v => update('rsiPeriod', v)} />
                <NumberInput label="Overbought" value={params.rsiOverbought} onChange={v => update('rsiOverbought', v)} />
                <NumberInput label="Oversold" value={params.rsiOversold} onChange={v => update('rsiOversold', v)} />
              </div>
            </div>

            <div className="h-px bg-slate-800" />

            <p className="text-[11px] text-slate-500">
              MACD (12,26,9), ATR (14), Bollinger Bands (20, 2), ADX (14), Stochastic RSI (14, 3, 3) and VWAP are fixed at standard defaults.
            </p>

            <div className="flex justify-between">
              <button
                onClick={() => onChange(DEFAULT_PARAMS)}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Reset to Defaults
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
      />
    </div>
  );
}
