import { test, section, done, assert, approx, candlesFromCloses, randomWalk, prng } from './harness';
import { ema, sma, rsi, atr, macd, bollinger, adx, stochasticRsi, vwap } from '../src/lib/indicators';
import { sanitizeCandles, dropFormingCandle, validateCandle, assessFreshness, CRYPTO_FRESHNESS, isFxWeekendWindow, assessSeriesHealth } from '../src/lib/data/validation';
import type { Candle } from '../src/types/trading';

section('Indicator mathematics');

// StockCharts / Wilder reference series for RSI(14)
const wilder = [44.3389,44.0902,44.1497,43.6124,44.3278,44.8264,45.0955,45.4245,45.8433,46.0826,45.8931,46.0328,45.6140,46.2820,46.2820,46.0000,46.0328,46.4116,46.2222,45.6439,46.2122,46.2538];
test('RSI(14) matches Wilder/StockCharts reference (70.53 first value)', () => {
  const r = rsi(candlesFromCloses(wilder), 14);
  approx(r[14]!, 70.53, 0.05, 'RSI[14]');
  assert(r.slice(0, 14).every(v => v === null), 'no RSI before period');
  // independent Wilder implementation (verified in Python): 66.28, 66.53, 69.39
  approx(r[15]!, 66.28, 0.01, 'RSI[15]'); approx(r[16]!, 66.53, 0.01, 'RSI[16]'); approx(r[17]!, 69.39, 0.01, 'RSI[17]');
});

test('SMA/EMA match independent computation', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.1);
  const cs = candlesFromCloses(closes);
  const e = ema(cs, 20);
  // independent: seed with SMA of first 20, then recursive
  let prev = closes.slice(0, 20).reduce((a, b) => a + b) / 20; const k = 2 / 21;
  approx(e[19]!, prev, 1e-9);
  for (let i = 20; i < 60; i++) { prev = closes[i] * k + prev * (1 - k); approx(e[i]!, prev, 1e-9, `EMA[${i}]`); }
  approx(sma(cs, 5)[10]!, closes.slice(6, 11).reduce((a, b) => a + b) / 5, 1e-9);
});

test('ATR(14) uses true range with Wilder smoothing', () => {
  const cs: Candle[] = Array.from({ length: 30 }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 100, high: 102, low: 98, close: 100 }));
  approx(atr(cs, 14)[29]!, 4, 1e-9);
  cs[20] = { ...cs[20], high: 110, close: 108 }; // gap-style TR
  const a = atr(cs, 14);
  assert(a[20]! > a[19]!, 'ATR rises on large TR');
});

test('MACD equals EMA12-EMA26 and signal is EMA9 of MACD', () => {
  const closes = Array.from({ length: 120 }, (_, i) => 50 + Math.sin(i / 7) * 5 + i * 0.05);
  const cs = candlesFromCloses(closes);
  const m = macd(cs, 12, 26, 9);
  const e12 = ema(cs, 12), e26 = ema(cs, 26);
  for (let i = 25; i < 120; i++) approx(m.macdLine[i]!, e12[i]! - e26[i]!, 1e-9);
  // independent signal
  const line = m.macdLine.slice(25) as number[];
  let sig = line.slice(0, 9).reduce((a, b) => a + b) / 9; const k = 2 / 10;
  approx(m.signalLine[25 + 8]!, sig, 1e-9);
  for (let i = 9; i < line.length; i++) { sig = line[i] * k + sig * (1 - k); approx(m.signalLine[25 + i]!, sig, 1e-9); }
  approx(m.histogram[100]!, m.macdLine[100]! - m.signalLine[100]!, 1e-12);
});

test('Bollinger(20,2) matches closed form for 1..20', () => {
  const cs = candlesFromCloses(Array.from({ length: 20 }, (_, i) => i + 1));
  const b = bollinger(cs, 20, 2);
  approx(b.mid[19]!, 10.5, 1e-12);
  const sd = Math.sqrt((20 * 20 - 1) / 12);
  approx(b.upper[19]!, 10.5 + 2 * sd, 1e-9); approx(b.lower[19]!, 10.5 - 2 * sd, 1e-9);
});

test('ADX is bounded 0..100 and high in a clean trend, low in a range', () => {
  const up = candlesFromCloses(Array.from({ length: 120 }, (_, i) => 100 + i * 1.5), 1_700_000_000, 3600, 0.2);
  const a = adx(up, 14).adx.filter((v): v is number => v !== null);
  assert(a.every(v => v >= 0 && v <= 100), 'bounds');
  assert(a[a.length - 1] > 40, `trend ADX ${a[a.length - 1]}`);
  const r = prng(11); let x = 0;
  const rangeCloses = Array.from({ length: 300 }, () => { x = x * 0.7 + (r() - 0.5) * 2; return 100 + x; }); // mean-reverting
  const range = candlesFromCloses(rangeCloses, 1_700_000_000, 3600, 0.3);
  const b = adx(range, 14).adx.filter((v): v is number => v !== null);
  assert(b[b.length - 1] < 25, `range ADX ${b[b.length - 1]}`);
  assert(b[b.length - 1] < a[a.length - 1], 'range ADX below trend ADX');
});

test('StochRSI stays within 0..100', () => {
  const s = stochasticRsi(randomWalk(200, 7), 14, 14, 3, 3);
  assert([...s.k, ...s.d].every(v => v === null || (v >= -1e-9 && v <= 100 + 1e-9)));
});

test('VWAP resets each UTC day; null without real volume; null on daily bars', () => {
  const day = 86400, t0 = Math.floor(1_700_000_000 / day) * day;
  const cs: Candle[] = [0, 1, 2, 3].map(i => ({ time: t0 + i * 43200, open: 10 + i * 10, high: 10 + i * 10, low: 10 + i * 10, close: 10 + i * 10, volume: 100 }));
  const v = vwap(cs);
  approx(v[0]!, 10, 1e-9); approx(v[1]!, 15, 1e-9, 'same-day cumulative');
  approx(v[2]!, 30, 1e-9, 'resets on new UTC day'); approx(v[3]!, 35, 1e-9);
  const noVol = cs.map(c => ({ ...c, volume: undefined }));
  assert(vwap(noVol).every(x => x === null), 'no volume → null');
  const daily: Candle[] = [0, 1, 2].map(i => ({ time: t0 + i * day, open: 1, high: 2, low: 1, close: 1.5, volume: 5 }));
  assert(vwap(daily).every(x => x === null), 'daily → null');
});

section('Data validation');
const base = randomWalk(80, 3);
test('rejects impossible OHLC, non-finite, negative volume, non-positive prices', () => {
  const bad: Candle[] = [
    { ...base[0], high: base[0].low - 1 },
    { ...base[1], close: NaN },
    { ...base[2], volume: -5 },
    { ...base[3], open: 0 },
    { ...base[4], time: 12 },
  ];
  bad.forEach(b => assert(validateCandle(b) !== null, JSON.stringify(b)));
  const r = sanitizeCandles([...bad, ...base.slice(5)], { timeframe: '1H', nowSec: base[79].time + 7200 });
  assert(r.dropped === 5 && r.candles.length === 75);
  assert(r.issues.filter(i => i.severity === 'error').length === 5);
});

test('de-duplicates (latest wins), sorts, and reports gaps for continuous markets', () => {
  const a = base.slice(0, 20);
  const shuffled = [a[5], ...a.slice(0, 5), ...a.slice(6), { ...a[10], close: a[10].close + 0.01, high: a[10].high + 0.05 }];
  const r = sanitizeCandles(shuffled, { timeframe: '1H', continuous: true, nowSec: a[19].time + 4000 });
  assert(r.candles.length === 20);
  assert(r.candles.every((c, i) => i === 0 || c.time > r.candles[i - 1].time));
  assert(r.issues.some(i => i.code === 'DUPLICATE') && r.issues.some(i => i.code === 'OUT_OF_ORDER'));
  const holes = a.filter((_, i) => i !== 8 && i !== 9);
  const g = sanitizeCandles(holes, { timeframe: '1H', continuous: true, nowSec: a[19].time + 4000 });
  assert(g.missingCandles === 2, `missing ${g.missingCandles}`);
  const fx = sanitizeCandles(holes, { timeframe: '1H', continuous: false, nowSec: a[19].time + 4000 });
  assert(fx.missingCandles === 0, 'weekend-style gaps are not errors for FX');
});

test('future-dated candles are rejected', () => {
  const now = base[10].time;
  const r = sanitizeCandles(base.slice(0, 20), { timeframe: '1H', nowSec: now });
  assert(r.candles.every(c => c.time <= now + 7200));
});

test('forming candle is dropped; closed candle is kept', () => {
  const cs = base.slice(0, 30);
  const last = cs[29];
  assert(dropFormingCandle(cs, '1H', last.time + 1800).length === 29, 'forming dropped');
  assert(dropFormingCandle(cs, '1H', last.time + 3600).length === 30, 'closed kept');
});

test('freshness thresholds and weekend labelling', () => {
  const now = 1_000_000;
  assert(assessFreshness(null, now, CRYPTO_FRESHNESS) === 'none');
  assert(assessFreshness(now - 5000, now, CRYPTO_FRESHNESS) === 'fresh');
  assert(assessFreshness(now - 20000, now, CRYPTO_FRESHNESS) === 'stale');
  assert(assessFreshness(now - 90000, now, CRYPTO_FRESHNESS) === 'dead');
  assert(isFxWeekendWindow(new Date('2026-10-24T12:00:00Z')) === true);   // Saturday
  assert(isFxWeekendWindow(new Date('2026-10-27T12:00:00Z')) === false);  // Tuesday
});

test('series health gate blocks analysis on thin or heavily-invalid data', () => {
  const thin = sanitizeCandles(base.slice(0, 10), { timeframe: '1H', nowSec: base[79].time });
  assert(assessSeriesHealth(thin, { minCandles: 50, continuous: true }).level === 'unusable');
  const ok = sanitizeCandles(base, { timeframe: '1H', continuous: true, nowSec: base[79].time + 7200 });
  assert(assessSeriesHealth(ok, { minCandles: 50, continuous: true }).level === 'ok');
});

done();
