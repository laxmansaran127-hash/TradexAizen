import type { TickerData, ConnectionState, AssetConfig } from '@/types/trading';
import { classNames, formatPrice, formatPercent, formatVolume } from '@/lib/format';
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import type { Freshness } from '@/lib/data/validation';

interface AssetPanelProps {
  config: AssetConfig;
  ticker: TickerData | null;
  connectionState: ConnectionState;
  liveCandleOpen?: number;
  freshness?: Freshness;
  marketClosed?: boolean;
}

export function AssetPanel({ config, ticker, connectionState, liveCandleOpen, freshness, marketClosed }: AssetPanelProps) {
  const isConnected = connectionState === 'live' && freshness !== 'stale' && freshness !== 'dead' && !marketClosed;
  const isStale = connectionState === 'live' && (freshness === 'stale' || freshness === 'dead');

  if (!ticker) {
    return (
      <div className="flex items-center gap-4 p-4 bg-slate-900/50 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-slate-100">{config.displaySymbol}</span>
          <span className="text-xs text-slate-500 hidden sm:inline">{config.name}</span>
        </div>
        <div className="text-sm text-slate-500 flex items-center gap-2">
          {connectionState === 'connecting' && (
            <>
              <div className="w-4 h-4 border-2 border-slate-600 border-t-sky-400 rounded-full animate-spin" />
              Connecting...
            </>
          )}
          {connectionState === 'reconnecting' && (
            <>
              <div className="w-4 h-4 border-2 border-slate-600 border-t-amber-400 rounded-full animate-spin" />
              Reconnecting...
            </>
          )}
          {connectionState === 'disconnected' && 'Disconnected'}
          {connectionState === 'live' && 'Loading live price...'}
        </div>
      </div>
    );
  }

  const hasChange = Number.isFinite(ticker.changePercent);
  const isUp = !hasChange || ticker.changePercent >= 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const openPrice = Number.isFinite(ticker.open) ? ticker.open : (liveCandleOpen ?? NaN);
  const dec = config.decimals;
  const pricePrefix = config.category === 'Forex' ? (config.symbol.includes('JPY') ? '¥' : '') : '$';
  const px = (v: number) => (Number.isFinite(v) ? `${pricePrefix}${formatPrice(v, dec)}` : '—');

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 bg-slate-900/50 border border-slate-800 rounded-xl">
      {/* Symbol + Name */}
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-slate-100">{config.displaySymbol}</span>
        <span className="text-xs text-slate-500 hidden sm:inline">{config.name}</span>
      </div>

      {/* Price + Change */}
      <div className="flex items-center gap-2">
        <span className={classNames('text-2xl font-bold', isUp ? 'text-emerald-400' : 'text-red-400')}>
          {px(ticker.price)}
        </span>
        <div className={classNames(
          'flex items-center gap-1 px-2 py-0.5 rounded-md text-sm font-semibold',
          !hasChange ? 'bg-slate-700/40 text-slate-400' : isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        )} title={hasChange ? '' : '24h change unavailable: loaded history does not cover 24 hours'}>
          <Icon className="w-3.5 h-3.5" />
          {hasChange ? formatPercent(ticker.changePercent) : '—'}
        </div>
      </div>

      {/* LIVE badge */}
      {isConnected && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-bold text-emerald-400 tracking-wide">LIVE</span>
        </div>
      )}

      {isStale && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30">
          <span className="text-xs font-bold text-amber-400 tracking-wide">STALE · last price may not reflect the market</span>
        </div>
      )}
      {marketClosed && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-700/40 border border-slate-600">
          <span className="text-xs font-bold text-slate-300 tracking-wide">MARKET CLOSED (weekend window)</span>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs">
        <Stat label="Open" value={px(openPrice)} />
        <Stat label="High" value={px(ticker.high)} valueClass="text-emerald-400" />
        <Stat label="Low" value={px(ticker.low)} valueClass="text-red-400" />
        <Stat label="Close" value={px(ticker.close)} />
        {ticker.volume !== undefined && ticker.volume > 0 && (
          <Stat label="Volume" value={formatVolume(ticker.volume)} />
        )}
        <div className="flex flex-col">
          <span className="text-slate-500 uppercase tracking-wider text-[10px] flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Updated
          </span>
          <span className="font-semibold text-slate-200">
            {new Date(ticker.timestamp * 1000).toLocaleTimeString('en-US')}
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-slate-500 uppercase tracking-wider text-[10px]">{label}</span>
      <span className={classNames('font-semibold text-slate-200', valueClass)}>{value}</span>
    </div>
  );
}
