import type { Candle, Timeframe } from '@/types/trading';
import { ASSET_CONFIGS, TF_SECONDS } from '@/types/trading';
import type { Asset } from '@/types/trading';
import type { NewsRiskDetail } from '@/lib/analysis/types';
import { runAnalysis } from '@/lib/analysis/engine';
import type { AizenState, PriceMap, TradeRecord } from './types';
import { buildDecision } from './bridge';
import { equityOf } from './accounting';
import { expirePending, logRisk, monitorPositions, processDecision } from './paperEngine';

// ── Agent cycle ─────────────────────────────────────────────────
// Pure orchestration with injected data sources, so the whole loop is testable offline and can run in a
// server worker later. Order of operations is fixed:
//   data → monitor open positions → (agent ON & not stopped) analyse → Aizen decision → RISK GATE → paper execution

export interface ContextBars { middle: Candle[] | null; higher: Candle[] | null; higherTf: Timeframe | null }

export interface AgentDeps {
  /** Entry-timeframe candles. Must THROW when data is unavailable (never return invented candles). */
  loadBars(assetId: Asset, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]>;
  loadContext(assetId: Asset, tf: Timeframe, signal?: AbortSignal): Promise<ContextBars>;
  newsFor(assetId: Asset, nowMs: number): NewsRiskDetail;
}

export interface CycleResult { closed: TradeRecord[]; errors: string[]; prices: PriceMap; analysed: string[] }

/** Fresh when the newest candle opened within the last two bar-lengths (covers the forming bar). */
export function feedFreshness(bars: Candle[], tf: Timeframe, nowSec: number): 'fresh' | 'stale' {
  const last = bars[bars.length - 1];
  return last && nowSec - last.time < 2 * TF_SECONDS[tf] ? 'fresh' : 'stale';
}

function logRiskOnce(s: AizenState, code: string, msg: string, nowSec: number): void {
  const dup = [...s.riskEvents].reverse().find(e => e.code === code && e.message === msg);
  if (!dup || nowSec - dup.time > 900) logRisk(s, 'warn', code, msg, nowSec);
}

export async function runCycle(s: AizenState, deps: AgentDeps, nowMs: number, signal?: AbortSignal): Promise<CycleResult> {
  const nowSec = Math.floor(nowMs / 1000);
  const set = s.settings;
  const tf = set.timeframe;
  const errors: string[] = [];
  const prices: PriceMap = {};
  const analysed: string[] = [];

  expirePending(s, nowSec);

  const analysing = set.agentOn && !set.emergencyStopped;
  const wanted = new Set<Asset>(s.positions.map(p => p.assetId));
  if (analysing) for (const id of set.assets) { const c = ASSET_CONFIGS.find(a => a.id === id); if (c && set.markets[c.category === 'Crypto' ? 'crypto' : c.category === 'Forex' ? 'forex' : 'gold']) wanted.add(id); }

  // 1 ── data (each asset isolated: one failing feed never blocks the others)
  const barsBy: { [id: string]: Candle[] | undefined } = {};
  for (const id of wanted) {
    if (signal?.aborted) break;
    const posTf = s.positions.find(p => p.assetId === id)?.timeframe ?? tf;
    try {
      const bars = await deps.loadBars(id, posTf, signal);
      if (!bars.length) throw new Error('empty candle series');
      barsBy[id] = bars;
      prices[id] = bars[bars.length - 1].close;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') break;
      const msg = `${id}: market data unavailable — ${(e as Error).message}`;
      errors.push(msg); logRiskOnce(s, 'data_unavailable', msg, nowSec);
    }
  }

  // 2 ── manage open positions (always, even when the agent is OFF or STOPPED)
  const closed = monitorPositions(s, barsBy, nowSec);
  s.account.peakEquity = Math.max(s.account.peakEquity, equityOf(s, prices));

  // 3 ── look for new trades
  if (analysing) {
    for (const id of set.assets) {
      if (signal?.aborted) break;
      const bars = barsBy[id];
      const cfg = ASSET_CONFIGS.find(a => a.id === id);
      if (!bars || !cfg || !wanted.has(id)) continue;
      if (s.positions.some(p => p.assetId === id)) continue;           // one position per asset

      const lastClosed = [...bars].reverse().find(b => b.time + TF_SECONDS[tf] <= nowSec);
      if (!lastClosed) continue;
      const key = `${id}:${tf}`;
      if (s.lastAnalyzedBar[key] === lastClosed.time) continue;          // already analysed this closed bar

      const feed = feedFreshness(bars, tf, nowSec);
      // Missing inputs are WAITED OUT, not decided on: the bar is NOT marked as analysed, so it is retried
      // next cycle once the feed / calendar is back (a transient outage must not burn the whole candle).
      if (feed === 'stale') { logRiskOnce(s, 'stale_data', `${id}: market data is stale (newest candle ${new Date(bars[bars.length - 1].time * 1000).toISOString()}) — not trading`, nowSec); continue; }
      const news = deps.newsFor(id, nowMs);
      if (set.risk.requireNewsCoverage && news.coverage === 'none') { logRiskOnce(s, 'news_unavailable', `${id}: news / economic-calendar data unavailable — waiting (trading blind is disabled)`, nowSec); continue; }
      let ctxBars: ContextBars = { middle: null, higher: null, higherTf: null };
      try { ctxBars = await deps.loadContext(id, tf, signal); } catch (e) { if ((e as Error)?.name === 'AbortError') break; }
      const kind = cfg.category === 'Crypto' ? 'crypto' : cfg.category === 'Forex' ? 'fx' : 'metal';
      const result = runAnalysis(bars, cfg.displaySymbol, tf, {
        decimals: cfg.decimals, kind, maxJump: kind === 'crypto' ? 0.5 : kind === 'fx' ? 0.05 : 0.08,
        feed, news, nowSec, contextCandles: { middle: ctxBars.middle, higher: ctxBars.higher },
      });
      const decision = buildDecision(result, cfg, tf, feed, nowSec);
      s.lastAnalyzedBar[key] = lastClosed.time;
      analysed.push(`${id} ${decision.decision}`);
      processDecision(s, decision, { nowSec, prices, livePrice: prices[id] ?? null, spreadBps: null, feed });
    }
  }

  s.heartbeat = { lastCycleAt: nowSec, lastError: errors[0] ?? null, cycles: s.heartbeat.cycles + 1 };
  return { closed, errors, prices, analysed };
}

/** Fresh price + freshness for one asset (used to re-validate an approval at the moment of execution). */
export async function latestPrice(deps: AgentDeps, assetId: Asset, tf: Timeframe, nowMs: number): Promise<{ price: number; feed: 'fresh' | 'stale' } | null> {
  try {
    const bars = await deps.loadBars(assetId, tf);
    if (!bars.length) return null;
    return { price: bars[bars.length - 1].close, feed: feedFreshness(bars, tf, Math.floor(nowMs / 1000)) };
  } catch { return null; }
}

