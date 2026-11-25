import type { ConnectionState } from '@/types/trading';
import type { Freshness } from '@/lib/data/validation';
import { classNames } from '@/lib/format';

interface LiveConnectionStatusProps {
  state: ConnectionState;
  className?: string;
  /** Data freshness (message age). A socket can be "open" while the data is stale. */
  freshness?: Freshness;
  /** Spot FX / gold weekend closure (only ever shown when the feed is also silent). */
  marketClosed?: boolean;
  onRetry?: () => void;
}

const CONFIG: Record<ConnectionState, { color: string; text: string; dotClass: string }> = {
  live:          { color: 'bg-emerald-500', text: 'LIVE',          dotClass: 'animate-pulse' },
  connecting:    { color: 'bg-sky-500',     text: 'CONNECTING',    dotClass: 'animate-pulse' },
  reconnecting:  { color: 'bg-amber-500',   text: 'RECONNECTING',  dotClass: 'animate-pulse' },
  disconnected:  { color: 'bg-red-500',     text: 'DISCONNECTED',  dotClass: '' },
};

export function LiveConnectionStatus({ state, className, freshness, marketClosed, onRetry }: LiveConnectionStatusProps) {
  let c = CONFIG[state];
  if (state === 'live' && marketClosed) c = { color: 'bg-slate-500', text: 'MARKET CLOSED', dotClass: '' };
  else if (state === 'live' && freshness === 'stale') c = { color: 'bg-amber-500', text: 'STALE DATA', dotClass: 'animate-pulse' };
  else if (state === 'live' && freshness === 'dead') c = { color: 'bg-red-500', text: 'NO DATA', dotClass: '' };

  const showRetry = !!onRetry && (state === 'disconnected' || freshness === 'dead');
  return (
    <div className={classNames(
      'flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 border border-slate-700',
      className
    )}>
      <span className={classNames('w-2 h-2 rounded-full', c.color, c.dotClass)} />
      <span className="text-xs font-semibold text-slate-300 tracking-wide">{c.text}</span>
      {showRetry && (
        <button onClick={onRetry} className="text-[10px] font-semibold text-sky-400 hover:text-sky-300 underline">
          Retry
        </button>
      )}
    </div>
  );
}
