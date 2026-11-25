import { useState } from 'react';
import type { AnalysisResult, ChartPattern } from '@/lib/analysis/types';
import { classNames, formatPrice } from '@/lib/format';
import {
  TrendingUp, TrendingDown, Minus, Activity, Layers, Droplets,
  Target, Zap, Shield, AlertTriangle, X, ChevronDown, ChevronRight,
  BarChart3, CandlestickChart, Gauge, ArrowUpCircle, ArrowDownCircle, Clock, Waves, GitBranch, CheckCircle2, XCircle
} from 'lucide-react';

interface AnalysisReportProps {
  result: AnalysisResult;
  onClose: () => void;
  /** A newer closed candle exists than the one this analysis used. */
  stale?: boolean;
  onRefresh?: () => void;
}

const EVIDENCE_LABEL: Record<string, { text: string; cls: string }> = {
  strong:       { text: 'Strong confirmation',   cls: 'text-emerald-400' },
  moderate:     { text: 'Moderate confirmation', cls: 'text-sky-400' },
  weak:         { text: 'Weak confirmation',     cls: 'text-amber-400' },
  conflicting:  { text: 'Conflicting evidence',  cls: 'text-orange-400' },
  insufficient: { text: 'Insufficient data',     cls: 'text-slate-400' },
};

export function AnalysisReport({ result, onClose, stale, onRefresh }: AnalysisReportProps) {
  const [selectedPattern, setSelectedPattern] = useState<ChartPattern | null>(null);
  const dec = result.decimals ?? 2;
  const px = (v: number) => formatPrice(v, dec);

  const decisionConfig = {
    BUY:      { color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', icon: TrendingUp },
    SELL:     { color: 'text-red-400',     bg: 'bg-red-500/15',     border: 'border-red-500/30',     icon: TrendingDown },
    WAIT:     { color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   icon: Minus },
    'NO TRADE': { color: 'text-slate-400', bg: 'bg-slate-500/15',   border: 'border-slate-500/30',   icon: Shield },
  };
  const dc = decisionConfig[result.decision];
  const DIcon = dc.icon;
  const ev = result.evidence;
  const evLabel = ev ? EVIDENCE_LABEL[ev.state] : null;
  const unavailable = !!result.unavailableReason;
  const nr = result.newsRiskDetail;
  const t = result.tradeSetup;
  const asOf = result.asOf ? new Date(result.asOf * 1000).toLocaleString() : null;

  return (
    <div className="bg-slate-900/80 border border-slate-700 rounded-xl overflow-hidden max-h-[calc(100vh-8rem)] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-bold text-slate-200">Analysis Report</h3>
          <span className="text-xs text-slate-500">{result.symbol} · {result.timeframe}</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded text-slate-500">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {stale && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> A newer candle has closed — this analysis is out of date.</span>
            {onRefresh && <button onClick={onRefresh} className="font-semibold underline">Re-analyze</button>}
          </div>
        )}
        {unavailable && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
            DATA UNAVAILABLE — {result.unavailableReason}. No analysis was produced and nothing has been inferred.
          </div>
        )}

        {/* Final Decision */}
        <div className={classNames('p-3 rounded-lg border', dc.bg, dc.border)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DIcon className={classNames('w-6 h-6', dc.color)} />
              <span className={classNames('text-lg font-bold', dc.color)}>{result.decision}</span>
            </div>
            <span className="text-xs text-slate-500">R:R {t ? t.riskReward.toFixed(2) : '—'}</span>
          </div>
          {evLabel && <div className={classNames('text-xs font-semibold mt-1', evLabel.cls)}>{evLabel.text}</div>}
        </div>

        <Section title="Decision Reasoning" icon={Shield} defaultOpen>
          <p className="text-xs text-slate-400 leading-relaxed">{result.decisionReason}</p>
          {ev && <p className="text-[11px] text-slate-500 leading-relaxed mt-2">{ev.explanation}</p>}
        </Section>

        {/* Evidence & gates */}
        {ev && ev.items.length > 0 && (
          <Section title={`Evidence (${ev.bullishPoints.toFixed(1)} bull / ${ev.bearishPoints.toFixed(1)} bear)`} icon={CheckCircle2}>
            <div className="space-y-1.5">
              {ev.items.map((i, k) => (
                <div key={k} className="text-[11px] leading-snug">
                  <span className={classNames('font-semibold', i.stance === 'bullish' ? 'text-emerald-400' : i.stance === 'bearish' ? 'text-red-400' : 'text-slate-400')}>
                    {i.factor}{i.weight > 0 ? ` (+${i.weight})` : ''}:
                  </span>{' '}
                  <span className="text-slate-500">{i.note}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
        {ev && (
          <Section title={`Safety Gates (${ev.gates.filter(g => g.passed).length}/${ev.gates.length} passed)`} icon={Shield} defaultOpen={ev.gates.some(g => !g.passed)}>
            <div className="space-y-1">
              {ev.gates.map((g, k) => (
                <div key={k} className="flex items-start gap-1.5 text-[11px]">
                  {g.passed ? <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400 shrink-0" /> : <XCircle className="w-3 h-3 mt-0.5 text-red-400 shrink-0" />}
                  <span><span className="text-slate-300 font-semibold">{g.name}:</span> <span className="text-slate-500">{g.note}</span></span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Chart Summary */}
        <Section title="Chart Summary" icon={BarChart3} defaultOpen>
          <p className="text-xs text-slate-400 leading-relaxed">{result.summary}</p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <MiniStat label="Timeframe" value={result.timeframe} />
            <MiniStat label="Closed candles" value={String(result.candleCount)} />
            <MiniStat label="Last close" value={result.lastPrice ? px(result.lastPrice) : '—'} />
            <MiniStat label="As of" value={asOf ?? '—'} />
          </div>
          {result.dataNotes && result.dataNotes.length > 0 && (
            <ul className="mt-2 text-[10px] text-amber-400/80 list-disc pl-4 space-y-0.5">
              {result.dataNotes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </Section>

        {/* Multi-timeframe */}
        <Section title="Multi-Timeframe Context" icon={GitBranch}>
          {result.mtf ? (
            <div className="space-y-1">
              <div className="text-xs text-slate-300 font-semibold">Alignment: {result.mtf.alignment.replace('-', ' ')}</div>
              {result.mtf.notes.map((n, i) => <p key={i} className="text-[11px] text-slate-500">{n}</p>)}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Higher-timeframe context unavailable — direction could not be cross-checked.</p>
          )}
        </Section>

        {/* Market Structure */}
        <Section title="Market Structure" icon={Layers} defaultOpen>
          <div className="flex items-center gap-2 mb-2">
            <span className={classNames('text-xs font-semibold',
              result.structure.state === 'bullish' ? 'text-emerald-400' :
              result.structure.state === 'bearish' ? 'text-red-400' :
              result.structure.state === 'transition' ? 'text-amber-400' : 'text-slate-400')}>
              {(result.structure.state ?? result.structure.currentBias).toUpperCase()}
            </span>
            {result.structure.activeHigh && <span className="text-[10px] text-slate-500">swing high {px(result.structure.activeHigh.price)}</span>}
            {result.structure.activeLow && <span className="text-[10px] text-slate-500">swing low {px(result.structure.activeLow.price)}</span>}
          </div>
          {result.structure.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.structure.labels.slice(-8).map((l, i) => (
                <span key={i} className={classNames('text-[10px] px-1.5 py-0.5 rounded font-mono',
                  l.label === 'HH' || l.label === 'HL' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                  {l.label}
                </span>
              ))}
            </div>
          )}
          {result.structure.events.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.structure.events.slice(-4).map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className={classNames('px-1.5 py-0.5 rounded font-mono font-bold',
                    e.direction === 'bullish' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                    {e.type}
                  </span>
                  <span className="text-slate-500">{e.direction} · closed beyond {px(e.level)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Trend */}
        <Section title="Trend" icon={TrendingUp}>
          <div className="flex items-center gap-2">
            <span className={classNames('text-xs font-semibold',
              result.trend === 'bullish' ? 'text-emerald-400' :
              result.trend === 'bearish' ? 'text-red-400' :
              result.trend === 'transition' ? 'text-amber-400' : 'text-slate-400')}>
              {result.trend.toUpperCase()}
            </span>
            <span className="text-xs text-slate-500">({result.trendStrength})</span>
          </div>
        </Section>

        {/* Support / Resistance */}
        <Section title="Support / Resistance" icon={Target}>
          <div className="space-y-1">
            {result.resistanceLevels.length === 0 && result.supportLevels.length === 0 && <p className="text-xs text-slate-500">No tested levels near price.</p>}
            {result.resistanceLevels.slice(0, 3).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-red-400">Resistance R{i + 1}</span>
                <span className="text-slate-300">{px(r.price)}</span>
                <span className="text-[10px] text-slate-500">{r.tested}× tested{r.flipped ? ' · flipped' : ''}{r.retest ? ' · retested' : ''}</span>
              </div>
            ))}
            <div className="border-t border-slate-700 my-1" />
            {result.supportLevels.slice(0, 3).map((s, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-emerald-400">Support S{i + 1}</span>
                <span className="text-slate-300">{px(s.price)}</span>
                <span className="text-[10px] text-slate-500">{s.tested}× tested{s.flipped ? ' · flipped' : ''}{s.retest ? ' · retested' : ''}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Supply / Demand */}
        <Section title="Supply / Demand" icon={Layers}>
          <div className="space-y-2">
            {result.zones.filter(z => !z.invalidated).slice(0, 4).map((z, i) => (
              <div key={i} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className={z.type === 'supply' ? 'text-red-400' : 'text-emerald-400'}>
                    {z.type === 'supply' ? 'Supply' : 'Demand'} · {z.strength ?? 'n/a'}{z.fresh ? ' · untested' : ` · ${z.retests ?? 0} retest(s)`}
                  </span>
                  <span className="text-slate-400">{px(z.bottom)} — {px(z.top)}</span>
                </div>
                {z.origin && <p className="text-[10px] text-slate-600 leading-snug">{z.origin}</p>}
                {z.invalidationPrice !== undefined && <p className="text-[10px] text-slate-600">Invalidated by a close beyond {px(z.invalidationPrice)}</p>}
              </div>
            ))}
            {result.zones.filter(z => !z.invalidated).length === 0 && <p className="text-xs text-slate-500">No valid zones detected.</p>}
          </div>
        </Section>

        {/* Liquidity */}
        <Section title="Liquidity" icon={Droplets}>
          {result.liquidity.recentSweep ? (
            <div className={classNames('text-xs p-2 rounded mb-2',
              result.liquidity.recentSweep.type === 'sell-side' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
              {result.liquidity.recentSweep.type} liquidity at {px(result.liquidity.recentSweep.price)} swept · reaction {result.liquidity.recentSweep.reaction}
            </div>
          ) : <p className="text-xs text-slate-500 mb-1">No recent sweep with a reaction.</p>}
          {result.liquidity.equalHighs.length > 0 && <div className="text-xs text-slate-400">Equal highs: {result.liquidity.equalHighs.map(e => px(e.price)).join(', ')}</div>}
          {result.liquidity.equalLows.length > 0 && <div className="text-xs text-slate-400">Equal lows: {result.liquidity.equalLows.map(e => px(e.price)).join(', ')}</div>}
          {result.liquidity.levels.filter(l => !l.swept).length > 0 && (
            <div className="text-xs text-slate-400">Resting liquidity levels: {result.liquidity.levels.filter(l => !l.swept).length}</div>
          )}
        </Section>

        {/* Chart Patterns */}
        <Section title="Chart Patterns" icon={BarChart3} defaultOpen>
          <div className="space-y-1">
            {result.chartPatterns.length === 0 ? (
              <p className="text-xs text-slate-500">No objectively supported pattern in current data.</p>
            ) : (
              result.chartPatterns.map((p, i) => (
                <button key={i} onClick={() => setSelectedPattern(selectedPattern === p ? null : p)}
                  className="w-full flex items-center justify-between text-xs p-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-2">
                    {selectedPattern === p ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                    <span className={classNames(p.direction === 'bullish' ? 'text-emerald-400' : p.direction === 'bearish' ? 'text-red-400' : 'text-slate-400')}>{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.context && p.context !== 'neutral' && <span className="text-[10px] text-slate-500">{p.context}</span>}
                    {p.confirmed ? <span className="text-[10px] text-emerald-400">confirmed</span> : <span className="text-[10px] text-amber-400">forming</span>}
                  </div>
                </button>
              ))
            )}
          </div>
          {selectedPattern && (
            <div className="mt-2 p-3 bg-slate-800/50 rounded-lg space-y-2">
              <p className="text-xs text-slate-300 font-semibold">{selectedPattern.name}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{selectedPattern.description}</p>
              <div className="space-y-1">
                {selectedPattern.keyLevels.map((kl, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-500">{kl.label}</span><span className="text-slate-300">{px(kl.price)}</span>
                  </div>
                ))}
                {selectedPattern.invalidation !== undefined && (
                  <div className="flex items-center justify-between text-[10px]"><span className="text-slate-500">Invalidation</span><span className="text-amber-400">{px(selectedPattern.invalidation)}</span></div>
                )}
              </div>
              <p className={classNames('text-[10px]', selectedPattern.confirmed ? 'text-emerald-400' : 'text-amber-400')}>{selectedPattern.confirmation}</p>
              <p className="text-[10px] text-slate-600">A pattern alone never creates a trade signal.</p>
            </div>
          )}
        </Section>

        {/* Candlesticks */}
        <Section title="Candlestick Patterns" icon={CandlestickChart}>
          <div className="space-y-1">
            {result.candlePatterns.length === 0 ? (
              <p className="text-xs text-slate-500">No qualifying candlestick pattern (size, trend and location filters applied).</p>
            ) : result.candlePatterns.slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className={classNames(c.direction === 'bullish' ? 'text-emerald-400' : c.direction === 'bearish' ? 'text-red-400' : 'text-slate-400')}>{c.name}</span>
                <span className="text-[10px] text-slate-500">{c.direction}{c.atKeyLevel ? ' · at key level' : ''}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Breakouts */}
        {result.breakouts && result.breakouts.length > 0 && (
          <Section title="Breakouts / Retests" icon={Zap}>
            <div className="space-y-1.5">
              {result.breakouts.slice(0, 4).map((b, i) => (
                <div key={i} className="text-[11px]">
                  <span className={b.direction === 'bullish' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{b.type.replace(/-/g, ' ')}</span>
                  <span className="text-slate-500"> @ {px(b.level)} — {b.note}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Indicators */}
        <Section title="Indicators (context only)" icon={Gauge} defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <IndicatorRow label="EMA 20" value={result.indicators.ema20} digits={dec} />
            <IndicatorRow label="EMA 50" value={result.indicators.ema50} digits={dec} />
            <IndicatorRow label="EMA 100" value={result.indicators.ema100} digits={dec} />
            <IndicatorRow label="EMA 200" value={result.indicators.ema200} digits={dec} />
            <IndicatorRow label="RSI 14" value={result.indicators.rsi} />
            <IndicatorRow label="ATR 14" value={result.indicators.atr} digits={dec} />
            <IndicatorRow label="MACD hist" value={result.indicators.macdHist} digits={Math.max(dec, 4)} />
            <IndicatorRow label="ADX" value={result.indicators.adx} />
            <IndicatorRow label="BB upper" value={result.indicators.bbUpper} digits={dec} />
            <IndicatorRow label="BB lower" value={result.indicators.bbLower} digits={dec} />
            <IndicatorRow label="StochRSI K" value={result.indicators.stochRsiK} />
            <IndicatorRow label="Session VWAP" value={result.indicators.vwap} digits={dec} />
          </div>
          <p className="text-[10px] text-slate-600 mt-2">VWAP and volume ratio need real traded volume; spot FX / gold feeds provide none, so they show —. Indicators never trigger a trade on their own.</p>
        </Section>

        {/* Momentum + Volatility */}
        {result.momentum && (
          <Section title="Momentum / Divergence" icon={Waves}>
            <p className="text-xs text-slate-300">{result.momentum.direction} · {result.momentum.state}</p>
            {result.momentum.notes.map((n, i) => <p key={i} className="text-[11px] text-slate-500">{n}</p>)}
            {result.momentum.divergences.length === 0 && <p className="text-[11px] text-slate-600">No divergence detected.</p>}
          </Section>
        )}
        {result.volatility && (
          <Section title="Volatility (ATR)" icon={Activity}>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Regime" value={result.volatility.regime} />
              <MiniStat label="Trend" value={result.volatility.trend} />
              <MiniStat label="ATR %" value={result.volatility.atrPercent !== null ? `${result.volatility.atrPercent.toFixed(3)}%` : '—'} />
              <MiniStat label="Min stop" value={result.volatility.minStopDistance !== null ? px(result.volatility.minStopDistance) : '—'} />
            </div>
            {result.volatility.notes.map((n, i) => <p key={i} className="text-[11px] text-amber-400/80 mt-1">{n}</p>)}
          </Section>
        )}

        {/* News Risk */}
        <Section title="News Risk" icon={AlertTriangle} defaultOpen={!!nr && nr.level !== 'low'}>
          {nr ? (
            <div className="space-y-1">
              <p className="text-xs">
                <span className="text-slate-500">Level: </span>
                <span className={nr.level === 'high' ? 'text-red-400 font-bold' : nr.level === 'medium' ? 'text-amber-400 font-semibold' : nr.level === 'low' ? 'text-emerald-400' : 'text-slate-400 font-semibold'}>
                  {nr.level === 'unknown' ? 'NEWS DATA UNAVAILABLE' : nr.level === 'high' ? 'HIGH NEWS RISK' : nr.level.toUpperCase()}
                </span>
                {nr.phase && <span className="text-slate-500"> · {nr.phase} release</span>}
              </p>
              {nr.nextEvent && <p className="text-[11px] text-slate-400">Next: {nr.nextEvent.currency} {nr.nextEvent.title} ({nr.nextEvent.impact}) at {new Date(nr.nextEvent.time).toLocaleString()}</p>}
              {nr.drivers.map((d, i) => <p key={i} className="text-[11px] text-slate-500">{d}</p>)}
              <p className="text-[10px] text-slate-600">Coverage: {nr.coverage}. News never creates a BUY/SELL by itself.</p>
            </div>
          ) : <p className="text-xs text-slate-500">NEWS DATA UNAVAILABLE</p>}
        </Section>

        {/* Scenarios */}
        <Section title="Bullish Scenario" icon={ArrowUpCircle}>
          <p className="text-xs text-emerald-400/80 leading-relaxed">{result.bullishScenario}</p>
        </Section>
        <Section title="Bearish Scenario" icon={ArrowDownCircle}>
          <p className="text-xs text-red-400/80 leading-relaxed">{result.bearishScenario}</p>
        </Section>

        {/* Trade Plan */}
        <Section title="Trade Plan" icon={Zap} defaultOpen>
          {t ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Direction</span>
                <span className={t.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}>{t.direction.toUpperCase()}</span>
              </div>
              <SetupRow label="Entry (last close ± band)" value={`${px(t.entryZone.low)} — ${px(t.entryZone.high)}`} />
              <SetupRow label="Stop Loss" value={px(t.stopLoss)} valueClass="text-red-400" />
              <SetupRow label={`TP1${t.rrTp1 ? ` (${t.rrTp1.toFixed(2)}R)` : ''}`} value={px(t.tp1)} valueClass="text-emerald-400" />
              <SetupRow label={`TP2${t.rrTp2 ? ` (${t.rrTp2.toFixed(2)}R)` : ''}`} value={px(t.tp2)} valueClass="text-emerald-400" />
              <SetupRow label={`TP3${t.rrTp3 ? ` (${t.rrTp3.toFixed(2)}R)` : ''}`} value={px(t.tp3)} valueClass="text-emerald-400" />
              <SetupRow label="Invalidation" value={px(t.invalidation)} valueClass="text-amber-400" />
              <SetupRow label="Risk / Reward (TP2)" value={t.riskReward.toFixed(2)} />
              {t.stopBasis && <p className="text-[10px] text-slate-500 pt-1">Stop: {t.stopBasis}{t.stopAtrMultiple ? ` (${t.stopAtrMultiple.toFixed(1)}× ATR)` : ''}</p>}
              {t.tpBasis && t.tpBasis.map((b, i) => <p key={i} className="text-[10px] text-slate-600">TP{i + 1}: {b.kind === 'structure' ? b.label : `⚠ ${b.label}`}</p>)}
              {t.riskGuidance && <p className="text-[10px] text-slate-500 pt-1 leading-relaxed">{t.riskGuidance}</p>}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No trade plan: {result.decision === 'BUY' || result.decision === 'SELL' ? 'plan unavailable' : 'conditions for a valid setup are not met. Entry / stop / targets are only produced for a confirmed BUY or SELL.'}</p>
          )}
        </Section>

        <div className="pt-2 border-t border-slate-700">
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Generated from validated real market data using rule-based analysis of closed candles. It describes current chart evidence only —
            it is not a prediction, does not guarantee profit, win rate or any outcome, and is not financial advice. Trading involves substantial risk of loss.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Section({ title, icon: Icon, children, defaultOpen = false }: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg bg-slate-800/30 border border-slate-800 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 transition-colors"
      >
        <Icon className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs font-semibold text-slate-300 flex-1 text-left">{title}</span>
        {open ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className="text-xs font-semibold text-slate-300">{value}</span>
    </div>
  );
}

function IndicatorRow({ label, value, digits = 2 }: { label: string; value: number | null | undefined; digits?: number }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 rounded bg-slate-800/40">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className="text-xs font-semibold text-slate-200">{value !== null && value !== undefined ? formatPrice(value, digits) : '—'}</span>
    </div>
  );
}

function SetupRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={classNames('font-semibold', valueClass ?? 'text-slate-200')}>{value}</span>
    </div>
  );
}
