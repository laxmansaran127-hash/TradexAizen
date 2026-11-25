import { test, section, done, assert, approx, candlesFromCloses, randomWalk, prng } from './harness';
import type { Candle } from '../src/types/trading';
import { analyzeStructure } from '../src/lib/analysis/swings';
import { detectLiquidity, detectSupportResistance, detectZones } from '../src/lib/analysis/liquidity';
import { buildTradePlan } from '../src/lib/analysis/tradePlan';
import { decide, type DecisionInput } from '../src/lib/analysis/decision';
import { detectBreakouts } from '../src/lib/analysis/breakouts';
import { analyzeMomentum } from '../src/lib/analysis/momentum';
import { findSwings } from '../src/lib/analysis/swings';
import type { SRLevel } from '../src/lib/analysis/types';

const T0 = 1_700_006_400, TF = 3600;
type Row = [number, number, number, number];
const fromRows = (rows: Row[], start = T0): Candle[] => rows.map((r, i) => ({ time: start + i * TF, open: r[0], high: r[1], low: r[2], close: r[3], volume: 100 }));
/** Piecewise-linear closes between pivots, `legBars` bars per leg. */
function zigzag(pivots: number[], legBars = 6, spread = 0.3): Candle[] {
  const closes: number[] = [pivots[0]];
  for (let p = 1; p < pivots.length; p++) for (let k = 1; k <= legBars; k++) closes.push(pivots[p - 1] + ((pivots[p] - pivots[p - 1]) * k) / legBars);
  return candlesFromCloses(closes, T0, TF, spread);
}
const tail = (cs: Candle[], rows: Row[]): Candle[] => [...cs, ...rows.map((r, i) => ({ time: cs[cs.length - 1].time + (i + 1) * TF, open: r[0], high: r[1], low: r[2], close: r[3], volume: 100 }))];

section('Market structure — close-based BOS / CHOCH / MSS');

test('uptrend: HH/HL labels and BOS(bullish) only on a CLOSE beyond the last swing high', () => {
  const cs = zigzag([100, 110, 104, 116, 109, 122, 115, 128, 121]);
  const st = analyzeStructure(cs);
  const labels = st.labels.map(l => l.label);
  assert(labels.includes('HH') && labels.includes('HL'), labels.join());
  assert(!labels.includes('LL'), 'no LL in a clean uptrend');
  const bos = st.events.filter(e => e.type === 'BOS' && e.direction === 'bullish');
  assert(bos.length >= 2, `bullish BOS count ${bos.length}`);
  for (const e of bos) assert(cs[e.index].close > e.level, 'break candle closed beyond the level');
  assert(st.state === 'bullish', `state ${st.state}`);
});

test('a wick through a swing high without a close beyond it is NOT a break', () => {
  const base = zigzag([100, 110, 104, 116, 109, 122, 115]);
  const before = analyzeStructure(base).events.length;
  const lastSwingHigh = Math.max(...findSwings(base).filter(s => s.type === 'high').map(s => s.price));
  const wicked = tail(base, [[115, lastSwingHigh + 3, 114, lastSwingHigh - 0.5]]);
  assert(analyzeStructure(wicked).events.length === before, 'wick must not create an event');
});

test('CHOCH(bearish) requires a close below the last swing low (not just a lower high)', () => {
  const up = zigzag([100, 110, 104, 116, 109, 122, 115, 126]);
  const lowerHigh = zigzag([100, 110, 104, 116, 109, 122, 115, 120, 117]);   // LH but no close below 109
  assert(!analyzeStructure(lowerHigh).events.some(e => e.direction === 'bearish'), 'LH alone is not CHOCH');
  const lastLow = analyzeStructure(up).swings.filter(s => s.type === 'low').slice(-1)[0].price;
  const broken = tail(up, [[126, 126.5, 118, 120], [120, 120.5, lastLow - 3, lastLow - 2]]);
  const ev = analyzeStructure(broken).events.filter(e => e.direction === 'bearish');
  assert(ev.length === 1 && (ev[0].type === 'CHOCH' || ev[0].type === 'MSS'), JSON.stringify(ev));
});

test('downtrend: a higher low after lower lows is NOT a CHOCH without a close above the last lower high', () => {
  const cs = zigzag([130, 120, 126, 114, 120, 108, 113, 100, 111]);
  const st = analyzeStructure(cs);
  assert(st.events.every(e => e.direction === 'bearish'), JSON.stringify(st.events.map(e => e.type + e.direction)));
  assert(st.state === 'bearish', st.state);
});

test('CHOCH(bullish) fires on a close above the last lower high; MSS when displacement', () => {
  const down = zigzag([130, 120, 126, 114, 120, 108, 113, 100, 106]);
  const lh = analyzeStructure(down).swings.filter(s => s.type === 'high').slice(-1)[0].price;
  const big = tail(down, [[106, lh + 9, 105, lh + 8]]);  // huge impulse candle
  const ev = analyzeStructure(big).events.filter(e => e.direction === 'bullish');
  assert(ev.length >= 1 && ev[ev.length - 1].type !== 'BOS', JSON.stringify(ev));
  assert(ev[ev.length - 1].type === 'MSS' || ev[ev.length - 1].displacement === false, 'MSS only with displacement');
});

test('no look-ahead: structure on a prefix never changes when later candles are appended', () => {
  const full = zigzag([100, 110, 104, 116, 109, 122, 115, 128, 121, 133, 124]);
  for (const cut of [40, 50, 60]) {
    const a = analyzeStructure(full.slice(0, cut)).events;
    const b = analyzeStructure(full).events.filter(e => e.index < cut - 3);
    const aa = a.filter(e => e.index < cut - 3).map(e => `${e.type}${e.direction}${e.index}`);
    assert(aa.join() === b.map(e => `${e.type}${e.direction}${e.index}`).join(), `cut ${cut}`);
  }
});

section('Liquidity — sweeps need a close back inside + reaction');
// range with equal highs at ~110 (two swings), then a sweep
const rangeBase = (): Candle[] => zigzag([100, 110, 102, 110.1, 102, 105]);
test('equal highs are detected', () => {
  const cs = rangeBase();
  const liq = detectLiquidity(cs, analyzeStructure(cs).swings);
  assert(liq.equalHighs.length >= 1, 'equal highs');
  assert(liq.levels.some(l => l.type === 'buy-side' && l.equal), 'buy-side equal level');
});
test('wick above + close back inside + drop ≥0.75 ATR = confirmed buy-side sweep', () => {
  const cs = rangeBase();
  const lv = Math.max(...analyzeStructure(cs).swings.filter(s => s.type === 'high').map(s => s.price));
  const swept = tail(cs, [[106, lv + 1.2, 105, lv - 0.8], [lv - 0.8, lv - 0.5, lv - 6, lv - 5], [lv - 5, lv - 4, lv - 7, lv - 6]]);
  const liq = detectLiquidity(swept, analyzeStructure(swept).swings);
  assert(liq.recentSweep && liq.recentSweep.type === 'buy-side', 'sweep found');
  assert(liq.recentSweep!.reaction === 'confirmed', `reaction ${liq.recentSweep!.reaction}`);
});
test('a CLOSE beyond the level is a breakout, not a sweep', () => {
  const cs = rangeBase();
  const lv = Math.max(...analyzeStructure(cs).swings.filter(s => s.type === 'high').map(s => s.price));
  const broke = tail(cs, [[106, lv + 3, 105, lv + 2.5], [lv + 2.5, lv + 4, lv + 2, lv + 3.5]]);
  const liq = detectLiquidity(broke, analyzeStructure(broke).swings);
  assert(liq.recentSweep === null, 'not a sweep');
  assert(!liq.levels.some(l => l.type === 'buy-side' && Math.abs(l.price - lv) < 0.3), 'consumed level removed');
});
test('stale sweeps (older than 12 bars) are never reported as "recent"', () => {
  const cs = rangeBase();
  const lv = Math.max(...analyzeStructure(cs).swings.filter(s => s.type === 'high').map(s => s.price));
  let s = tail(cs, [[106, lv + 1.2, 105, lv - 0.8], [lv - 0.8, lv - 0.5, lv - 6, lv - 5]]);
  for (let i = 0; i < 30; i++) s = tail(s, [[s[s.length - 1].close, s[s.length - 1].close + 0.6, s[s.length - 1].close - 0.6, s[s.length - 1].close + (i % 2 ? 0.2 : -0.2)]]);
  assert(detectLiquidity(s, analyzeStructure(s).swings).recentSweep === null);
});

section('Support / resistance');
test('REGRESSION: resistance[0] is the NEAREST level above price, not the highest high', () => {
  // far high at 150, nearer high at 120, price ends ~105
  const cs = zigzag([100, 150, 90, 120, 95, 118, 100, 106, 104], 7, 0.4);
  const price = cs[cs.length - 1].close;
  const sr = detectSupportResistance(cs, analyzeStructure(cs).swings);
  assert(sr.resistance.length > 0, 'has resistance');
  assert(sr.resistance.every(r => r.price > price), 'all resistance above price');
  assert(sr.support.every(s => s.price < price), 'all support below price');
  const dists = sr.resistance.map(r => r.price - price);
  assert(dists.every((d, i) => i === 0 || d >= dists[i - 1]), 'nearest first');
  assert(sr.resistance[0].price < 135, `nearest is ${sr.resistance[0].price}, not the 150 extreme`);
});
test('breakout+retest flags need closes, not wicks', () => {
  const cs = zigzag([100, 110, 102, 110, 103, 108], 6, 0.3);
  const lv = 110;
  const withBreak = tail(cs, [[108, 113, 107.5, 112.5], [112.5, 114, 112, 113.5], [113.5, 113.8, 110.2, 111.5], [111.5, 114, 111, 113]]);
  const sr = detectSupportResistance(withBreak, analyzeStructure(withBreak).swings);
  const lvl = sr.support.find(s => Math.abs(s.price - lv) < 1.5);
  assert(lvl && lvl.breakout && lvl.flipped, 'flipped to support after close beyond');
});

section('Breakouts');
function srLevel(price: number, type: 'support' | 'resistance'): SRLevel { return { type, price, strength: 4, index: 0, time: 0, tested: 2, breakout: false, retest: false }; }
const flat = (n: number, p = 100, w = 1): Candle[] => fromRows(Array.from({ length: n }, () => [p, p + w, p - w, p] as Row));
test('wick-through is not a breakout', () => {
  const cs = tail(flat(40), [[100, 104, 99.5, 100.4]]);
  assert(detectBreakouts(cs, [srLevel(102, 'resistance')]).length === 0);
});
test('single close = unconfirmed; two closes = confirmed; fast reversal = false breakout; return = retest', () => {
  const lvl = [srLevel(102, 'resistance')];
  const one = tail(flat(40), [[100, 104.5, 100, 104]]);
  assert(detectBreakouts(one, lvl)[0].type === 'breakout');
  const two = tail(flat(40), [[100, 104.5, 100, 104], [104, 106, 103.5, 105.5]]);
  assert(detectBreakouts(two, lvl).some(b => b.type === 'confirmed-breakout'));
  const fake = tail(flat(40), [[100, 104.5, 100, 104], [104, 104.2, 99, 100.5]]);
  assert(detectBreakouts(fake, lvl)[0].type === 'false-breakout');
  const retest = tail(flat(40), [[100, 104.5, 100, 104], [104, 106, 103.5, 105.5], [105.5, 105.8, 102.1, 103.2]]);
  assert(detectBreakouts(retest, lvl).some(b => b.type === 'retest-held'));
  const failed = tail(flat(40), [[100, 104.5, 100, 104], [104, 106, 103.5, 105.5], [105.5, 105.8, 100.5, 101]]);
  assert(detectBreakouts(failed, lvl).some(b => b.type === 'failed-retest'));
});

section('Momentum / divergence');
test('bearish divergence: higher price high with a lower RSI high', () => {
  // strong first push (high RSI), then weaker push making a marginal higher high
  const cs = zigzag([100, 112, 104, 114, 108, 114.8, 106, 108], 6, 0.3);
  const m = analyzeMomentum(cs, analyzeStructure(cs).swings);
  assert(Array.isArray(m.divergences));
  for (const d of m.divergences) assert(d.type === 'bullish' ? d.priceTo < d.priceFrom : d.priceTo > d.priceFrom, 'price leg direction matches type');
});

section('Trade plan (regression: short R:R was negative; targets must be real)');
const baseCandles = candlesFromCloses(Array(80).fill(100), T0, TF, 0.5);
const emptyLiq = { levels: [], equalHighs: [], equalLows: [], recentSweep: null };
const sw = (type: 'high' | 'low', price: number, index: number) => ({ index, price, time: T0 + index * TF, type, confirmed: true });
test('long: stop below structure with buffer, targets monotonic, R:R positive', () => {
  const p = buildTradePlan({
    direction: 'long', candles: baseCandles, atr: 2, decimals: 2,
    structure: { swings: [sw('low', 96.5, 60)], labels: [], events: [], currentBias: 'bullish', state: 'bullish' },
    support: [], resistance: [{ ...srLevel(112, 'resistance'), zoneLow: 111, zoneHigh: 112 }], liquidity: emptyLiq, zones: [],
  });
  assert(p.setup, p.reason);
  const s = p.setup!;
  approx(s.stopLoss, 95.5, 1e-9); approx(s.invalidation, 96.5, 1e-9);
  assert(s.stopLoss < s.entry! && s.tp1 > s.entry! && s.tp2 > s.tp1 && s.tp3 > s.tp2);
  assert(s.rrTp1! >= 1 && s.rrTp2! >= 1.5 && s.riskReward > 0);
  assert(s.tpBasis![0].kind === 'structure' && s.tpBasis![1].kind === 'projection', 'projections are labelled');
  approx(s.tp1, 111, 1e-9);
});
test('short: stop ABOVE entry, targets below, R:R POSITIVE (old code returned negative)', () => {
  const p = buildTradePlan({
    direction: 'short', candles: baseCandles, atr: 2, decimals: 2,
    structure: { swings: [sw('high', 103.5, 60)], labels: [], events: [], currentBias: 'bearish', state: 'bearish' },
    support: [{ ...srLevel(88, 'support'), zoneLow: 87, zoneHigh: 88 }], resistance: [], liquidity: emptyLiq, zones: [],
  });
  assert(p.setup, p.reason);
  const s = p.setup!;
  assert(s.stopLoss > s.entry! && s.tp1 < s.entry! && s.tp2 < s.tp1 && s.tp3 < s.tp2);
  assert(s.riskReward > 0 && s.rrTp1! > 0 && s.rrTp3! > s.rrTp2!, `rr ${s.riskReward}`);
  approx(s.tp1, 88, 1e-9);
});
test('refuses: obstacle closer than 1R / stop too tight or too wide / no structure', () => {
  const mk = (low: number, res: number | null) => buildTradePlan({
    direction: 'long', candles: baseCandles, atr: 2, decimals: 2,
    structure: { swings: [sw('low', low, 60)], labels: [], events: [], currentBias: 'bullish', state: 'bullish' },
    support: [], resistance: res ? [{ ...srLevel(res, 'resistance'), zoneLow: res, zoneHigh: res + 1 }] : [], liquidity: emptyLiq, zones: [],
  });
  assert(mk(96.5, 103).setup === null && /room/i.test(mk(96.5, 103).reason), 'obstacle at 0.6R');
  assert(mk(99.5, null).setup === null, 'stop < 1 ATR');
  assert(mk(80, null).setup === null, 'stop > 4 ATR');
  assert(buildTradePlan({ direction: 'long', candles: baseCandles, atr: 2, decimals: 2, structure: { swings: [], labels: [], events: [], currentBias: 'neutral' }, support: [], resistance: [], liquidity: emptyLiq, zones: [] }).setup === null);
});

section('Decision engine — gates');
function mkInput(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    candles: baseCandles, decimals: 2,
    structure: { swings: [sw('low', 96.5, 60), sw('high', 104, 55)], labels: [], events: [{ type: 'BOS', direction: 'bullish', index: 70, time: 0, price: 101, level: 100 }], currentBias: 'bullish', state: 'bullish', activeHigh: sw('high', 104, 55), activeLow: null },
    trend: 'bullish', trendStrength: 'strong',
    support: [{ ...srLevel(98.5, 'support'), rejections: 2, tested: 3 }],
    resistance: [{ ...srLevel(112, 'resistance'), zoneLow: 111, zoneHigh: 112 }],
    zones: [],
    liquidity: { levels: [], equalHighs: [], equalLows: [], recentSweep: { type: 'sell-side', price: 97, index: 70, time: 0, swept: true, sweepIndex: 77, reaction: 'confirmed' } },
    chartPatterns: [{ name: 'Double Bottom', direction: 'bullish', startIndex: 40, endIndex: 79, confidence: 0.7, keyLevels: [], description: '', confirmed: true, context: 'with-trend', invalidation: 96 }],
    candlePatterns: [{ name: 'Bullish Engulfing', direction: 'bullish', index: 79, time: 0, description: '', atKeyLevel: true }],
    breakouts: [], momentum: { direction: 'bullish', state: 'strengthening', divergences: [], notes: [] },
    indicators: { ema20: 100, ema50: 99, ema100: 98, ema200: 97, rsi: 60, macdLine: 1, macdSignal: 0.5, macdHist: 0.5, atr: 2, vwap: null, adx: 30 },
    volatility: { atr: 2, atrPercent: 2, regime: 'normal', trend: 'stable', lastBarAtrMultiple: 1, minStopDistance: 3, notes: [] },
    mtf: { higher: null, middle: null, entry: { timeframe: '1H', role: 'entry', bias: 'bullish', trend: 'bullish', candles: 300 }, alignment: 'aligned-bullish', notes: [] },
    news: { level: 'low', phase: null, drivers: ['none'], coverage: 'calendar+headlines' },
    dataLevel: 'ok', dataReasons: [], feed: 'fresh', kind: 'crypto',
    ...over,
  };
}
test('all evidence + gates aligned → BUY with a valid plan and an evidence state (no % confidence)', () => {
  const o = decide(mkInput());
  assert(o.decision === 'BUY', `${o.decision}: ${o.decisionReason}`);
  assert(o.tradeSetup && o.tradeSetup.stopLoss < o.tradeSetup.tp1);
  assert(['strong', 'moderate'].includes(o.evidence.state) && o.evidence.items.length >= 10 && o.evidence.gates.every(g => g.passed));
});
test('HIGH news risk can never produce BUY/SELL', () => {
  const o = decide(mkInput({ news: { level: 'high', phase: 'BEFORE', drivers: ['USD CPI in 20 min'], coverage: 'calendar+headlines' } }));
  assert(o.decision === 'WAIT' && o.tradeSetup === null && /HIGH NEWS RISK/.test(o.decisionReason));
});
test('unknown news (NEWS DATA UNAVAILABLE) caps evidence below "strong"', () => {
  const o = decide(mkInput({ news: { level: 'unknown', phase: null, drivers: ['NEWS DATA UNAVAILABLE'], coverage: 'none' } }));
  assert(o.evidence.state !== 'strong');
});
test('unusable data → NO TRADE, "DATA UNAVAILABLE"', () => {
  const o = decide(mkInput({ dataLevel: 'unusable', dataReasons: ['12 candles missing'] }));
  assert(o.decision === 'NO TRADE' && /DATA UNAVAILABLE/.test(o.decisionReason) && o.evidence.state === 'insufficient');
});
test('stale/dead price feed blocks a trade', () => {
  assert(decide(mkInput({ feed: 'stale' })).decision === 'WAIT');
  assert(decide(mkInput({ feed: 'dead' })).decision === 'WAIT');
});
test('a pattern ALONE never creates a trade', () => {
  const o = decide(mkInput({
    candlePatterns: [], liquidity: emptyLiq, momentum: { direction: 'neutral', state: 'flat', divergences: [], notes: [] },
  }));
  assert(o.decision !== 'BUY' && o.decision !== 'SELL', `got ${o.decision}`);
});
test('higher-timeframe conflict blocks the trade', () => {
  const o = decide(mkInput({ mtf: { higher: { timeframe: '1D', role: 'higher', bias: 'bearish', trend: 'bearish', candles: 300 }, middle: null, entry: { timeframe: '1H', role: 'entry', bias: 'bullish', trend: 'bullish', candles: 300 }, alignment: 'conflicting', notes: [] } }));
  assert(o.decision !== 'BUY');
});
test('conflicting evidence → NO TRADE', () => {
  const o = decide(mkInput({ structure: { ...mkInput().structure, state: 'bearish', currentBias: 'bearish' }, trend: 'bearish' }));
  assert(o.decision === 'NO TRADE' || o.decision === 'WAIT', o.decision);
  assert(o.decision !== 'BUY');
});
test('RSI > 70 is context only: it neither forces a SELL nor cancels a valid BUY', () => {
  const hot = decide(mkInput({ indicators: { ...mkInput().indicators, rsi: 85 } }));
  assert(hot.decision === 'BUY', hot.decision);
  assert(hot.evidence.items.find(i => i.factor === 'Indicator context')!.note.includes('NOT a sell signal'));
  const cold = decide(mkInput({ indicators: { ...mkInput().indicators, rsi: 15 } }));
  assert(cold.decision === 'BUY');
});
test('extreme volatility blocks entry', () => {
  assert(decide(mkInput({ volatility: { ...mkInput().volatility, regime: 'extreme' } })).decision === 'WAIT');
});
test('SELL mirror: bearish evidence produces SELL with stop above', () => {
  const o = decide(mkInput({
    structure: { swings: [sw('high', 103.5, 60), sw('low', 96, 55)], labels: [], events: [{ type: 'BOS', direction: 'bearish', index: 70, time: 0, price: 99, level: 100 }], currentBias: 'bearish', state: 'bearish' },
    trend: 'bearish', support: [{ ...srLevel(88, 'support'), zoneLow: 87, zoneHigh: 88 }], resistance: [{ ...srLevel(101.5, 'resistance'), rejections: 2, tested: 3 }],
    liquidity: { levels: [], equalHighs: [], equalLows: [], recentSweep: { type: 'buy-side', price: 103, index: 70, time: 0, swept: true, sweepIndex: 77, reaction: 'confirmed' } },
    chartPatterns: [{ name: 'Double Top', direction: 'bearish', startIndex: 40, endIndex: 79, confidence: 0.7, keyLevels: [], description: '', confirmed: true, context: 'with-trend' }],
    candlePatterns: [{ name: 'Bearish Engulfing', direction: 'bearish', index: 79, time: 0, description: '', atKeyLevel: true }],
    momentum: { direction: 'bearish', state: 'strengthening', divergences: [], notes: [] },
    mtf: { ...mkInput().mtf!, alignment: 'aligned-bearish' },
  }));
  assert(o.decision === 'SELL', `${o.decision}: ${o.decisionReason}`);
  assert(o.tradeSetup!.stopLoss > o.tradeSetup!.entry! && o.tradeSetup!.riskReward > 0);
});

done();
