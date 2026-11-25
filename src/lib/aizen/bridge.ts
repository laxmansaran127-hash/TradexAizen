import type { AssetConfig, Timeframe } from '@/types/trading';
import type { AnalysisResult } from '@/lib/analysis/types';
import type { AizenDecision } from './types';
import { categoryOf } from './instruments';

// ── TradeXLive analysis → Aizen decision ────────────────────────
// Aizen does not re-decide: it only turns a deterministic engine verdict (BUY/SELL with a full plan and
// all gates passed) into LONG/SHORT. Every number in `reasoning` is read from the analysis result;
// anything null is reported as unavailable instead of being invented.

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function buildDecision(a: AnalysisResult | null, asset: AssetConfig, tf: Timeframe, feed: 'fresh' | 'stale', nowSec: number): AizenDecision {
  const base = {
    assetId: asset.id, symbol: asset.displaySymbol, category: categoryOf(asset.id), timeframe: tf, feed, createdAt: nowSec,
  };
  const none = (engineDecision: string, reason: string, reasoning: string[], asOf: number | null, gates: AizenDecision['gates'] = [], news = 'none'): AizenDecision => ({
    ...base, id: `${asset.id}:${tf}:${asOf ?? 'na'}:none`, decision: engineDecision === 'WAIT' ? 'WAIT' : 'NO TRADE', asOf,
    entry: null, stopLoss: null, tp1: null, tp2: null, tp3: null, riskReward: null, atr: null,
    engineDecision, engineReason: reason, reasoning, gates, newsCoverage: news,
  });

  if (!a) return none('NO DATA', 'No market data was available for analysis.', ['No candles were available — nothing was inferred.'], null);
  const gates = a.evidence?.gates ?? [];
  const news = a.newsRiskDetail?.coverage ?? 'none';
  if (a.unavailableReason) return none(a.decision, a.decisionReason, [`DATA UNAVAILABLE — ${a.unavailableReason}`], a.asOf ?? null, gates, news);

  const d = a.decimals ?? 2;
  const f = (v: number) => v.toFixed(d);
  const long = a.decision === 'BUY';
  const lines: string[] = [];
  const ind = a.indicators, px = a.lastPrice;

  lines.push(`TradeXLive engine verdict: ${a.decision} — ${a.decisionReason}`);
  lines.push(`Structure ${a.structure.state ?? a.structure.currentBias}; trend ${a.trend} (${a.trendStrength}).`);
  if (fin(ind.ema20) && fin(ind.ema50)) lines.push(`EMA: price ${f(px)} is ${px > ind.ema20 ? 'above' : 'below'} EMA20 (${f(ind.ema20)}) and ${px > ind.ema50 ? 'above' : 'below'} EMA50 (${f(ind.ema50)}).`);
  if (fin(ind.rsi)) lines.push(`RSI ${ind.rsi.toFixed(1)} (context only).`);
  if (fin(ind.macdHist)) lines.push(`MACD histogram ${ind.macdHist >= 0 ? 'positive' : 'negative'} (${ind.macdHist.toPrecision(3)}).`);
  lines.push(fin(ind.vwap) ? `VWAP ${f(ind.vwap)}: price is ${px > ind.vwap ? 'above' : 'below'}.` : 'VWAP unavailable on this feed (no real volume) — not used.');
  const sw = a.liquidity.recentSweep;
  if (sw) lines.push(`Recent ${sw.type} liquidity sweep at ${f(sw.price)}${sw.reaction ? ` (reaction: ${sw.reaction})` : ''}.`);
  if (a.mtf) lines.push(`Multi-timeframe: ${a.mtf.alignment}${a.mtf.notes.length ? ` — ${a.mtf.notes[0]}` : ''}.`);
  else lines.push('Multi-timeframe context unavailable.');
  if (a.evidence) {
    lines.push(`Evidence ${a.evidence.bullishPoints.toFixed(1)} bullish / ${a.evidence.bearishPoints.toFixed(1)} bearish (${a.evidence.state}).`);
    const want = long ? 'bullish' : 'bearish';
    const top = a.evidence.items.filter(i => i.stance === want).sort((x, y) => y.weight - x.weight).slice(0, 4);
    for (const i of top) lines.push(`${i.factor}: ${i.note}`);
    const failed = a.evidence.gates.filter(g => !g.passed);
    lines.push(failed.length ? `Failed gates: ${failed.map(g => `${g.name} (${g.note})`).join('; ')}` : `All ${a.evidence.gates.length} safety gates passed.`);
  }
  const s = a.tradeSetup;
  if (s?.stopBasis) lines.push(`Stop basis: ${s.stopBasis}.`);
  if (s?.tpBasis) lines.push(`Targets: ${s.tpBasis.map((t, i) => `TP${i + 1} ${t.kind} (${t.label})`).join('; ')}.`);

  const wantsTrade = a.decision === 'BUY' || a.decision === 'SELL';
  const entry = s?.entry ?? a.lastPrice;
  const atr = fin(ind.atr) ? ind.atr : a.volatility?.atr ?? null;
  const complete = !!s && [entry, s.stopLoss, s.tp1, s.tp2, s.tp3, atr].every(fin) && fin(a.asOf);
  if (!wantsTrade || !complete) {
    const why = wantsTrade ? 'Engine signalled a trade but the plan is incomplete.' : a.decisionReason;
    return none(a.decision, why, lines, a.asOf ?? null, gates, news);
  }
  return {
    ...base, id: `${asset.id}:${tf}:${a.asOf}:${long ? 'long' : 'short'}`, decision: long ? 'LONG' : 'SHORT', asOf: a.asOf!,
    entry, stopLoss: s!.stopLoss, tp1: s!.tp1, tp2: s!.tp2, tp3: s!.tp3,
    riskReward: s!.rrTp2 ?? s!.riskReward ?? null, atr, engineDecision: a.decision, engineReason: a.decisionReason,
    reasoning: lines, gates, newsCoverage: news,
  };
}
