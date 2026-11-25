import { useState } from 'react';
import { BitcoinWidget } from '@/components/BitcoinWidget';
import { GoldWidget } from '@/components/GoldWidget';
import { ForexWidget } from '@/components/ForexWidget';
import { CryptoWidget } from '@/components/CryptoWidget';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ASSET_CONFIGS, type Asset } from '@/types/trading';
import { classNames } from '@/lib/format';

const SELECTABLE_ASSETS: Asset[] = ['BTC', 'ETH', 'XRP', 'SOL', 'BCH', 'LTC', 'EURUSD', 'GBPUSD', 'USDJPY', 'GOLD'];

const CATEGORY_COLORS: Record<string, string> = {
  Crypto: 'text-amber-400',
  Forex: 'text-sky-400',
  Metals: 'text-amber-400',
};

export function ChartsPage() {
  const [selected, setSelected] = useState<Asset>('BTC');

  const selectedConfig = ASSET_CONFIGS.find(a => a.id === selected)!;

  return (
    <div className="p-3 lg:p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Live Charts</h1>
        <span className="text-xs text-slate-500">Real-time data · No refresh required</span>
      </div>

      {/* Asset selector */}
      <div className="flex flex-wrap items-center gap-1 bg-slate-900/50 border border-slate-800 rounded-xl p-1.5">
        {SELECTABLE_ASSETS.map(assetId => {
          const config = ASSET_CONFIGS.find(a => a.id === assetId)!;
          const isActive = selected === assetId;
          return (
            <button
              key={assetId}
              onClick={() => setSelected(assetId)}
              className={classNames(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all',
                isActive
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50',
              )}
            >
              <span className={classNames('text-xs font-bold', CATEGORY_COLORS[config.category])}>
                {config.displaySymbol}
              </span>
              <span className={classNames(
                'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded',
                isActive ? 'bg-slate-700 text-slate-300' : 'bg-slate-800/50 text-slate-500',
              )}>
                {config.category}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected asset chart — wrapped in ErrorBoundary so one failing chart never blanks the page */}
      {selected === 'BTC' && (
        <ErrorBoundary key="BTC" featureName="BTC Chart"><BitcoinWidget /></ErrorBoundary>
      )}
      {selected === 'GOLD' && (
        <ErrorBoundary key="GOLD" featureName="Gold Chart"><GoldWidget /></ErrorBoundary>
      )}
      {(selected === 'ETH' || selected === 'XRP' || selected === 'SOL' || selected === 'BCH' || selected === 'LTC') && (
        <ErrorBoundary key={selected} featureName={`${selectedConfig.displaySymbol} Chart`}>
          <CryptoWidget config={selectedConfig} />
        </ErrorBoundary>
      )}
      {selected !== 'BTC' && selected !== 'GOLD' && selected !== 'ETH' && selected !== 'XRP' && selected !== 'SOL' && selected !== 'BCH' && selected !== 'LTC' && (
        <ErrorBoundary key={selected} featureName={`${selectedConfig.displaySymbol} Chart`}>
          <ForexWidget config={selectedConfig} />
        </ErrorBoundary>
      )}
    </div>
  );
}
