import { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  TrendingUp,
  Newspaper,
  RefreshCw,
  ExternalLink,
  Activity,
} from 'lucide-react';
import type { ImpactLevel, EventPhase, InstrumentMode } from '@/types/news';
import { useNewsAnalysis } from '@/hooks/useNewsAnalysis';
import type { NewsState } from '@/types/news';
import {
  formatLocalTime,
  formatRelativeTime,
  formatDateTime,
  deriveMode,
} from '@/utils/newsUtils';

interface NewsAnalysisPanelProps {
  displaySymbol: string;
  assetId: string;
  category: string;
  /** Shared news state from the parent (so the feed is fetched once). */
  state?: NewsState;
}

const IMPACT_STYLES: Record<ImpactLevel, { bg: string; text: string; border: string; label: string }> = {
  HIGH: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30', label: 'HIGH' },
  MEDIUM: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', label: 'MEDIUM' },
  LOW: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', label: 'LOW' },
};

const PHASE_STYLES: Record<EventPhase, { bg: string; text: string; label: string; pulse?: boolean }> = {
  BEFORE: { bg: 'bg-sky-500/15', text: 'text-sky-400', label: 'BEFORE' },
  DURING: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'DURING', pulse: true },
  AFTER: { bg: 'bg-slate-600/20', text: 'text-slate-400', label: 'AFTER' },
};

export function NewsAnalysisPanel({ displaySymbol, assetId, category, state }: NewsAnalysisPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [showMedium, setShowMedium] = useState(false);
  const [showLow, setShowLow] = useState(false);

  const mode: InstrumentMode = useMemo(
    () => deriveMode(category, displaySymbol),
    [category, displaySymbol],
  );

  const own = useNewsAnalysis({ mode, displaySymbol, assetId, enabled: !state });
  const { items, loading, error, lastUpdated, sourceUsed } = state ?? own;

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (item.impact === 'HIGH') return true;
      if (item.impact === 'MEDIUM') return showMedium;
      if (item.impact === 'LOW') return showLow;
      return false;
    });
  }, [items, showMedium, showLow]);

  const highCount = items.filter(i => i.impact === 'HIGH').length;
  const mediumCount = items.filter(i => i.impact === 'MEDIUM').length;
  const lowCount = items.filter(i => i.impact === 'LOW').length;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
      {/* Header / toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/50 transition-colors"
      >
        <Newspaper className="w-4 h-4 text-sky-400 flex-shrink-0" />
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">News Analysis</span>
        {highCount > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
            {highCount} HIGH
          </span>
        )}
        <div className="flex-1" />
        {lastUpdated && !loading && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Updated {formatLocalTime(lastUpdated)}
          </span>
        )}
        {loading && <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-slate-800 px-3 py-2.5 space-y-3">
          {/* Filter toggles */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Show:</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
              HIGH ({highCount})
            </span>
            <ToggleChip
              active={showMedium}
              onClick={() => setShowMedium(!showMedium)}
              label={`MEDIUM (${mediumCount})`}
              color="amber"
            />
            <ToggleChip
              active={showLow}
              onClick={() => setShowLow(!showLow)}
              label={`LOW (${lowCount})`}
              color="emerald"
            />
            <div className="flex-1" />
            {sourceUsed && (
              <span className="text-[10px] text-slate-500">
                Source: <span className="text-slate-400">{sourceUsed}</span>
              </span>
            )}
          </div>

          {/* Content */}
          {error && items.length === 0 ? (
            <div className="flex items-center gap-2 py-6 justify-center text-slate-500 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400/60" />
              <span>NEWS DATA UNAVAILABLE — retrying. No news is shown or inferred while the source is down.</span>
            </div>
          ) : filteredItems.length === 0 && !loading ? (
            <div className="py-6 text-center text-slate-500 text-xs">
              No {showMedium || showLow ? '' : 'high-impact '}news for {displaySymbol} at this time.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredItems.map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-[10px] text-slate-600 flex items-center gap-1 pt-1 border-t border-slate-800/50">
            <Activity className="w-3 h-3" />
            News shown as confirmation context only — does not generate trading signals.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Toggle chip ──────────────────────────────────────────────────

function ToggleChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color: 'amber' | 'emerald';
}) {
  const activeStyles = color === 'amber'
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  const inactiveStyles = 'bg-slate-800/50 text-slate-500 border-slate-700/50';

  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
        active ? activeStyles : inactiveStyles
      }`}
    >
      {label}
    </button>
  );
}

// ── News card ────────────────────────────────────────────────────

function NewsCard({ item }: { item: import('@/types/news').NewsItem }) {
  const impactStyle = IMPACT_STYLES[item.impact];
  const phaseStyle = PHASE_STYLES[item.phase];

  return (
    <div className={`rounded-lg border ${impactStyle.border} bg-slate-800/30 p-2.5 space-y-1.5`}>
      {/* Badges + time */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${impactStyle.bg} ${impactStyle.text} border ${impactStyle.border}`}>
          {impactStyle.label}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${phaseStyle.bg} ${phaseStyle.text} ${phaseStyle.pulse ? 'animate-pulse' : ''}`}>
          {phaseStyle.label}
        </span>
        <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          {formatRelativeTime(item.publishedAt)}
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-500">{item.source}</span>
      </div>

      {/* Headline */}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-slate-200 font-medium hover:text-sky-400 transition-colors flex items-start gap-1 group"
      >
        {item.impact === 'HIGH' && <AlertTriangle className="w-3.5 h-3.5 text-red-400/70 flex-shrink-0 mt-0.5" />}
        {item.impact === 'MEDIUM' && <TrendingUp className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0 mt-0.5" />}
        <span className="flex-1">{item.headline}</span>
        <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-sky-400 flex-shrink-0 mt-0.5" />
      </a>

      {/* Market context */}
      {item.marketContext && (
        <p className="text-[11px] text-slate-400 leading-relaxed pl-4">
          {item.marketContext}
        </p>
      )}

      {/* Economic data */}
      {(item.economic.actual || item.economic.forecast || item.economic.previous) && (
        <div className="flex items-center gap-3 text-[10px] pl-4">
          {item.economic.actual && (
            <span className="text-slate-400">
              Actual: <span className="text-slate-200 font-mono">{item.economic.actual}</span>
            </span>
          )}
          {item.economic.forecast && (
            <span className="text-slate-400">
              Forecast: <span className="text-slate-200 font-mono">{item.economic.forecast}</span>
            </span>
          )}
          {item.economic.previous && (
            <span className="text-slate-400">
              Previous: <span className="text-slate-200 font-mono">{item.economic.previous}</span>
            </span>
          )}
        </div>
      )}

      {/* Event time (if scheduled) */}
      {item.eventTime && (
        <p className="text-[10px] text-slate-500 pl-4">
          Event time: {formatDateTime(item.eventTime)}
        </p>
      )}
    </div>
  );
}
