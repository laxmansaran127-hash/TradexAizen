import { useState, useMemo } from 'react';
import { Maximize2, Minimize2, RefreshCw, AlertCircle, Bitcoin, Zap, Loader2 } from 'lucide-react';
import { useOrderFlow } from '@/hooks/useOrderFlow';
import { OrderFlowIndicator } from '@/components/OrderFlowIndicator';
import type { Timeframe } from '@/types/trading';
import { ASSET_CONFIGS } from '@/types/trading';
import { useBinanceChart } from '@/hooks/useBinanceChart';
import { AssetChart } from '@/components/AssetChart';
import { AssetPanel } from '@/components/AssetPanel';
import { TimeframeSelector } from '@/components/TimeframeSelector';
import { LiveConnectionStatus } from '@/components/LiveConnectionStatus';
import { AnalysisReport } from '@/components/AnalysisReport';
import { IndicatorDashboard } from '@/components/IndicatorDashboard';
import { NewsAnalysisPanel } from '@/components/NewsAnalysisPanel';
import { generateOverlay } from '@/lib/analysis/engine';
import type { ChartOverlay } from '@/lib/analysis/types';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAnalysisRunner } from '@/hooks/useAnalysisRunner';
import { useNewsAnalysis } from '@/hooks/useNewsAnalysis';
import { useEconomicCalendar } from '@/hooks/useEconomicCalendar';
import { useAlertFeed } from '@/hooks/useAlertFeed';
import { deriveMode } from '@/utils/newsUtils';
import { classNames } from '@/lib/format';

export function BitcoinWidget() {
  const config = ASSET_CONFIGS.find((a) => a.id === 'BTC')!;
  const [timeframe, setTimeframe] = useState<Timeframe>('1H');
  const [fullscreen, setFullscreen] = useState(false);

  const { candles, liveCandle, ticker, connectionState, loading, error, freshness, dataHealth, retry } = useBinanceChart(timeframe);
  const mode = useMemo(() => deriveMode(config.category, config.displaySymbol), [config.category, config.displaySymbol]);
  const news = useNewsAnalysis({ mode, displaySymbol: config.displaySymbol, assetId: config.id });
  const calendar = useEconomicCalendar();
  useAlertFeed(config.displaySymbol, ticker, freshness);
  const { analysis, setAnalysis, analyzing, handleAnalyze, canAnalyze, blockedReason, analysisStale } = useAnalysisRunner({
    config, timeframe, candles, loading, freshness, floorTime: undefined, news, calendar,
  });

  const { data: orderFlowData, connectionState: orderFlowConn } = useOrderFlow(timeframe);

  const overlay: ChartOverlay | null = useMemo(() => {
    if (!analysis) return null;
    return generateOverlay(analysis);
  }, [analysis]);

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col p-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Bitcoin className="w-5 h-5 text-amber-400" />
            <span className="text-lg font-bold text-white">{config.displaySymbol}</span>
          </div>
          <TimeframeSelector timeframe={timeframe} onChange={setTimeframe} />
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            title={blockedReason ?? ''}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Analyze
          </button>
          <div className="flex-1" />
          <LiveConnectionStatus state={connectionState} freshness={freshness} onRetry={retry} />
          <button onClick={() => setFullscreen(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400">
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex gap-3">
          <div className="flex-1 min-h-0">
            {loading ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading chart data...
              </div>
            ) : error ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <AlertCircle className="w-8 h-8 text-red-400/50" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            ) : (
              <AssetChart candles={candles} liveCandle={liveCandle} fullscreen overlay={overlay} />
            )}
          </div>
          {analysis && (
            <div className="w-[340px] flex-shrink-0 overflow-y-auto">
              <ErrorBoundary featureName="Analysis Report"><AnalysisReport result={analysis} onClose={() => setAnalysis(null)} stale={analysisStale} onRefresh={handleAnalyze} /></ErrorBoundary>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AssetPanel
        config={config}
        ticker={ticker}
        connectionState={connectionState}
        liveCandleOpen={liveCandle?.open}
        freshness={freshness}
        
      />

      <div className="flex flex-wrap items-center gap-2 bg-slate-900/50 border border-slate-800 rounded-xl p-2">
        <div className="flex items-center gap-2">
          <Bitcoin className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-slate-300">{config.label}</span>
        </div>
        <div className="w-px h-6 bg-slate-700" />
        <TimeframeSelector timeframe={timeframe} onChange={setTimeframe} />
        <div className="flex-1" />
        <button
          onClick={handleAnalyze}
          disabled={!canAnalyze}
            title={blockedReason ?? ''}
          className={classNames(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
            analyzing ? 'bg-slate-700 text-slate-400' : 'bg-sky-500 hover:bg-sky-400 text-white',
            !canAnalyze && !analyzing && 'opacity-50 cursor-not-allowed'
          )}
        >
          {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          Analyze
        </button>
        <LiveConnectionStatus state={connectionState} freshness={freshness} onRetry={retry} />
        <button onClick={() => setFullscreen(true)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400">
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {dataHealth.level !== 'ok' && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300">
          Data quality {dataHealth.level.toUpperCase()}: {dataHealth.reasons.join('; ')}. Analysis is blocked while data is unusable.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-2 h-[400px] lg:h-[500px]">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading BTC chart data...
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <AlertCircle className="w-8 h-8 text-red-400/50" />
              <p className="text-sm text-slate-500">Chart data unavailable.</p>
            </div>
          ) : (
            <AssetChart candles={candles} liveCandle={liveCandle} overlay={overlay} />
          )}
        </div>
        {analysis && (
          <ErrorBoundary featureName="Analysis Report"><AnalysisReport result={analysis} onClose={() => setAnalysis(null)} stale={analysisStale} onRefresh={handleAnalyze} /></ErrorBoundary>
        )}
      </div>

      <ErrorBoundary featureName="Order Flow"><OrderFlowIndicator data={orderFlowData} connectionState={orderFlowConn} /></ErrorBoundary>

      <ErrorBoundary featureName="Indicators"><IndicatorDashboard candles={candles} decimals={config.decimals} /></ErrorBoundary>

      <ErrorBoundary featureName="News"><NewsAnalysisPanel displaySymbol={config.displaySymbol} assetId={config.id} category={config.category} state={news} /></ErrorBoundary>
    </div>
  );
}
