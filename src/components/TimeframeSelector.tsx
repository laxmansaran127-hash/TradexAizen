import type { Timeframe } from '@/types/trading';
import { TIMEFRAMES } from '@/types/trading';
import { classNames } from '@/lib/format';

interface TimeframeSelectorProps {
  timeframe: Timeframe;
  onChange: (tf: Timeframe) => void;
}

export function TimeframeSelector({ timeframe, onChange }: TimeframeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-lg p-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={classNames(
            'px-2.5 py-1.5 rounded text-xs font-semibold transition-all',
            timeframe === tf
              ? 'bg-sky-500 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
