import { useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import type { ConnectionState } from '@/types/trading';
import type { OrderFlowData, PriceLevel } from '@/hooks/useOrderFlow';
import { classNames, formatPrice, formatVolume } from '@/lib/format';

interface OrderFlowIndicatorProps {
  data: OrderFlowData | null;
  connectionState: ConnectionState;
  maxHeight?: number;
}

export function OrderFlowIndicator({ data, connectionState, maxHeight = 280 }: OrderFlowIndicatorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAllLevels, setShowAllLevels] = useState(false);

  const isConnected = connectionState === 'live';
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';

  const totalVol = data ? data.buyVolume + data.sellVolume : 0;
  const buyPct = totalVol > 0 ? (data!.buyVolume / totalVol) * 100 : 50;
  const sellPct = 100 - buyPct;
  const delta = data?.delta ?? 0;
  const deltaPositive = delta >= 0;

  // Sort levels by price descending — show highest at top
  const allLevels = data?.levels ?? [];
  const maxLevelVol = allLevels.reduce((max, l) => Math.max(max, l.buyVolume + l.sellVolume), 0);
  const visibleLevels = showAllLevels ? allLevels : allLevels.slice(0, 12);
  const hiddenCount = allLevels.length - visibleLevels.length;

  // Find the POC (Point of Control) — price level with highest volume
  const pocLevel = allLevels.reduce((max, l) =>
    (l.buyVolume + l.sellVolume) > (max.buyVolume + max.sellVolume) ? l : max,
    allLevels[0] ?? { price: 0, buyVolume: 0, sellVolume: 0, buyCount: 0, sellCount: 0 },
  );

  const timeRemaining = data ? data.candleEnd - Math.floor(Date.now() / 1000) : 0;
  const minsRemaining = Math.max(0, Math.floor(timeRemaining / 60));
  const secsRemaining = Math.max(0, timeRemaining % 60);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <Activity className="w-4 h-4 text-sky-400" />
        <span className="text-sm font-semibold text-slate-200">Order Flow</span>
        <span className="text-xs text-slate-500 hidden sm:inline">BTC/USDT · Footprint</span>
        <div className="flex-1" />
        {isConnected && data && (
          <span className="text-xs text-slate-500 tabular-nums">
            {minsRemaining}:{secsRemaining.toString().padStart(2, '0')} left
          </span>
        )}
        <div className={classNames(
          'flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide',
          isConnected ? 'bg-emerald-500/10 text-emerald-400' :
          isConnecting ? 'bg-sky-500/10 text-sky-400' :
          'bg-red-500/10 text-red-400'
        )}>
          <span className={classNames('w-1.5 h-1.5 rounded-full',
            isConnected ? 'bg-emerald-500 animate-pulse' :
            isConnecting ? 'bg-sky-500 animate-pulse' :
            'bg-red-500'
          )} />
          {isConnected ? 'LIVE' : isConnecting ? 'CONNECTING' : 'OFFLINE'}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition-colors"
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-3" style={{ maxHeight, overflowY: 'auto' }}>
          {!isConnected && !isConnecting && (
            <div className="flex items-center justify-center py-8 text-sm text-red-400">
              ORDER FLOW DATA UNAVAILABLE — stream disconnected. Reconnecting; nothing is simulated.
            </div>
          )}

          {isConnecting && !data && (
            <div className="flex items-center justify-center py-8 text-sm text-slate-500">
              <div className="w-4 h-4 border-2 border-slate-600 border-t-sky-400 rounded-full animate-spin mr-2" />
              Connecting to trade stream...
            </div>
          )}

          {data && (
            <>
              {data.trackingSince > data.candleStart + 2 && (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                  PARTIAL CANDLE — trades are counted only since {new Date(data.trackingSince * 1000).toLocaleTimeString()} (page opened or stream resumed mid-candle). Delta and volume exclude earlier trades in this candle.
                </div>
              )}
              {/* Summary metrics row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric
                  label="Delta"
                  value={`${delta >= 0 ? '+' : ''}${formatVolume(Math.abs(delta))}`}
                  icon={deltaPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  valueClass={deltaPositive ? 'text-emerald-400' : 'text-red-400'}
                />
                <Metric
                  label="CVD"
                  value={`${data.cvd >= 0 ? '+' : ''}${formatVolume(Math.abs(data.cvd))}`}
                  valueClass={data.cvd >= 0 ? 'text-emerald-400' : 'text-red-400'}
                />
                <Metric
                  label="Agg. trades"
                  value={data.totalTrades.toString()}
                  subValue={`${data.buyTrades}B / ${data.sellTrades}S`}
                />
                <Metric
                  label="VWAP"
                  value={`$${formatPrice(data.vwap)}`}
                />
              </div>

              {/* Buy/Sell volume bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 font-semibold">{formatVolume(data.buyVolume)} Buy</span>
                  <span className="text-slate-500">Volume Distribution</span>
                  <span className="text-red-400 font-semibold">{formatVolume(data.sellVolume)} Sell</span>
                </div>
                <div className="flex h-5 rounded-md overflow-hidden bg-slate-800">
                  <div
                    className="bg-emerald-500/60 transition-all duration-300 flex items-center justify-start px-1.5"
                    style={{ width: `${buyPct}%` }}
                  >
                    {buyPct > 15 && <span className="text-[10px] font-bold text-emerald-200">{buyPct.toFixed(1)}%</span>}
                  </div>
                  <div
                    className="bg-red-500/60 transition-all duration-300 flex items-center justify-end px-1.5"
                    style={{ width: `${sellPct}%` }}
                  >
                    {sellPct > 15 && <span className="text-[10px] font-bold text-red-200">{sellPct.toFixed(1)}%</span>}
                  </div>
                </div>
              </div>

              {/* Footprint — price-level breakdown */}
              <div className="space-y-0.5">
                <div className="grid grid-cols-[1fr_auto_1fr] gap-1 text-[10px] text-slate-500 uppercase tracking-wider pb-1 border-b border-slate-800">
                  <span className="text-right">Sell Volume</span>
                  <span className="text-center px-2">Price</span>
                  <span className="text-left">Buy Volume</span>
                </div>
                {visibleLevels.length === 0 && (
                  <div className="text-center py-4 text-xs text-slate-500">Waiting for trades...</div>
                )}
                {visibleLevels.map((level, i) => (
                  <FootprintRow
                    key={level.price}
                    level={level}
                    maxVol={maxLevelVol}
                    isPoc={pocLevel && level.price === pocLevel.price}
                    isLast={i === visibleLevels.length - 1}
                  />
                ))}
                {hiddenCount > 0 && !showAllLevels && (
                  <button
                    onClick={() => setShowAllLevels(true)}
                    className="w-full text-center text-xs text-sky-400 hover:text-sky-300 py-1.5 transition-colors"
                  >
                    Show {hiddenCount} more levels
                  </button>
                )}
                {showAllLevels && allLevels.length > 12 && (
                  <button
                    onClick={() => setShowAllLevels(false)}
                    className="w-full text-center text-xs text-sky-400 hover:text-sky-300 py-1.5 transition-colors"
                  >
                    Show fewer
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  subValue,
  icon,
  valueClass,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="bg-slate-800/40 rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={classNames('text-sm font-bold tabular-nums text-slate-200', valueClass)}>
        {value}
      </div>
      {subValue && <div className="text-[10px] text-slate-500">{subValue}</div>}
    </div>
  );
}

function FootprintRow({
  level,
  maxVol,
  isPoc,
  isLast,
}: {
  level: PriceLevel;
  maxVol: number;
  isPoc: boolean;
  isLast: boolean;
}) {
  const totalVol = level.buyVolume + level.sellVolume;
  const sellPct = maxVol > 0 ? (level.sellVolume / maxVol) * 100 : 0;
  const buyPct = maxVol > 0 ? (level.buyVolume / maxVol) * 100 : 0;
  const rowDelta = level.buyVolume - level.sellVolume;
  const deltaPositive = rowDelta >= 0;

  return (
    <div className={classNames(
      'grid grid-cols-[1fr_auto_1fr] gap-1 items-center text-xs py-0.5 px-1 rounded transition-colors',
      isPoc && 'bg-sky-500/5 ring-1 ring-sky-500/20',
    )}>
      {/* Sell side (left, right-aligned) */}
      <div className="flex items-center justify-end gap-1">
        <span className="text-red-400/80 tabular-nums text-[10px] w-12 text-right">
          {level.sellVolume > 0 ? formatVolume(level.sellVolume) : '—'}
        </span>
        <div className="h-3 rounded-sm bg-red-500/40" style={{ width: `${Math.min(sellPct, 100) * 0.7}px` }} />
      </div>

      {/* Price (center) */}
      <div className={classNames(
        'px-2 py-0.5 rounded text-center font-semibold tabular-nums min-w-[70px]',
        isPoc ? 'bg-sky-500/20 text-sky-300' : 'text-slate-300',
      )}>
        ${formatPrice(level.price)}
      </div>

      {/* Buy side (right, left-aligned) */}
      <div className="flex items-center gap-1">
        <div className="h-3 rounded-sm bg-emerald-500/40" style={{ width: `${Math.min(buyPct, 100) * 0.7}px` }} />
        <span className="text-emerald-400/80 tabular-nums text-[10px] w-12">
          {level.buyVolume > 0 ? formatVolume(level.buyVolume) : '—'}
        </span>
      </div>

      {/* Delta indicator (optional inline) */}
      {totalVol > 0 && (
        <div className={classNames(
          'col-span-3 text-[9px] text-center tabular-nums -mt-0.5',
          deltaPositive ? 'text-emerald-500/50' : 'text-red-500/50',
        )}>
          {deltaPositive ? '+' : ''}{formatVolume(Math.abs(rowDelta))}
        </div>
      )}
    </div>
  );
}
