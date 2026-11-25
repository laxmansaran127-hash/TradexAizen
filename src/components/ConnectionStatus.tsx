import type { ConnectionState } from '@/types/trading';
import { classNames } from '@/lib/format';

const CONFIG: Record<ConnectionState, { color: string; text: string; dotClass: string }> = {
  live:         { color: 'bg-emerald-500', text: 'LIVE',          dotClass: 'animate-pulse' },
  connecting:   { color: 'bg-sky-500',     text: 'CONNECTING',    dotClass: 'animate-pulse' },
  reconnecting: { color: 'bg-amber-500',   text: 'RECONNECTING',  dotClass: 'animate-pulse' },
  disconnected: { color: 'bg-red-500',     text: 'DISCONNECTED',  dotClass: '' },
};

export function ConnectionStatus({ state, className }: { state: ConnectionState; className?: string }) {
  const c = CONFIG[state] ?? CONFIG.disconnected;
  return (
    <div className={classNames('flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 border border-slate-700', className)}>
      <span className={classNames('w-2 h-2 rounded-full', c.color, c.dotClass)} />
      <span className="text-xs font-semibold text-slate-300 tracking-wide">{c.text}</span>
    </div>
  );
}

export function LiveBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/30">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-xs font-semibold text-emerald-400 tracking-wide">LIVE DATA</span>
    </div>
  );
}
