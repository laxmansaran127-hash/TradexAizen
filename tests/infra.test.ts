import { test, section, done, assert, approx, randomWalk, prng } from './harness';
import type { Candle } from '../src/types/trading';

// ── Fake WebSocket (installed before importing the manager) ──
class FakeWS {
  static OPEN = 1; static CLOSED = 3; static instances: FakeWS[] = [];
  readyState = 0; url: string;
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null; onclose: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  close() { if (this.readyState === 3) return; this.readyState = 3; setTimeout(() => this.onclose?.(), 0); }
  send() {}
  open() { this.readyState = 1; this.onopen?.(); }
  msg(d: string) { this.onmessage?.({ data: d }); }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const alive = () => FakeWS.instances.filter(w => w.readyState !== 3).length;

const { ManagedSocket } = await import('../src/lib/data/managedSocket');
const { applyTick, parseTwelveResponse, parseTwelveDatetime, compute24hStats } = await import('../src/lib/data/fxProviders');
const { parseBinanceFrame, mergeCandle, mergeCandleLists, combinedStreamUrls } = await import('../src/lib/data/binance');
const { parseCalendar } = await import('../src/lib/news/calendar');
const { assessNewsRisk, relevantCurrencies } = await import('../src/lib/news/risk');
const { runAnalysis, generateOverlay } = await import('../src/lib/analysis/engine');
const { fetchJson } = await import('../src/lib/data/http');

section('ManagedSocket lifecycle');
test('REGRESSION: stopping never leaves a zombie that reconnects on its own', async () => {
  FakeWS.instances = [];
  const s = new ManagedSocket({ urls: ['ws://a'], onMessage: () => {}, onStatus: () => {}, baseDelayMs: 5, maxDelayMs: 20 });
  s.start(); s.stop();
  await sleep(120);
  assert(FakeWS.instances.length === 1, `instances ${FakeWS.instances.length}`);
  assert(alive() === 0, 'socket closed');
});
test('REGRESSION: 60 rapid asset/timeframe switches leave zero live sockets after the last stop', async () => {
  FakeWS.instances = [];
  for (let i = 0; i < 60; i++) {
    const s = new ManagedSocket({ urls: ['ws://x' + i], onMessage: () => {}, onStatus: () => {}, baseDelayMs: 2, maxDelayMs: 5 });
    s.start(); FakeWS.instances[FakeWS.instances.length - 1]?.open(); s.stop();
  }
  await sleep(150);
  assert(alive() === 0, `alive ${alive()}`);
  assert(FakeWS.instances.length === 60, `no reconnect storms: ${FakeWS.instances.length}`);
});
test('reconnects after a server-side close, rotates URL, status flows reconnecting→live', async () => {
  FakeWS.instances = []; const st: string[] = []; const got: string[] = [];
  const s = new ManagedSocket({ urls: ['ws://one', 'ws://two'], onMessage: m => got.push(m), onStatus: x => { if (st[st.length - 1] !== x) st.push(x); }, baseDelayMs: 5, maxDelayMs: 20 });
  s.start(); const a = FakeWS.instances[0]; a.open(); a.msg('{"p":1}');
  assert(st.includes('live') && got.length === 1);
  a.close(); await sleep(80);
  assert(FakeWS.instances.length >= 2 && FakeWS.instances[1].url === 'ws://two', 'rotated mirror');
  FakeWS.instances[1].open(); FakeWS.instances[1].msg('{"p":2}');
  assert(st.includes('reconnecting') && st[st.length - 1] === 'live' && got.length === 2, st.join());
  s.stop(); await sleep(20);
});
test('keeps retrying forever (bounded rate) and reports "disconnected" after the fast attempts', async () => {
  FakeWS.instances = []; const st: string[] = [];
  const s = new ManagedSocket({ urls: ['ws://dead'], onMessage: () => {}, onStatus: x => st.push(x), baseDelayMs: 2, maxDelayMs: 10, maxFastAttempts: 3 });
  s.start();
  for (let i = 0; i < 12; i++) { await sleep(25); const w = FakeWS.instances[FakeWS.instances.length - 1]; if (w.readyState !== 3) w.close(); }
  await sleep(40);
  assert(st.includes('disconnected'), 'reaches disconnected');
  assert(FakeWS.instances.length >= 6, 'still retrying');
  s.stop(); await sleep(30);
  const n = FakeWS.instances.length; await sleep(60);
  assert(FakeWS.instances.length === n, 'no attempts after stop');
});
test('watchdog recycles a connection that is open but silent', async () => {
  FakeWS.instances = [];
  const s = new ManagedSocket({ urls: ['ws://quiet'], onMessage: () => {}, onStatus: () => {}, staleAfterMs: 400, baseDelayMs: 5, maxDelayMs: 10 });
  s.start(); FakeWS.instances[0].open();
  await sleep(1100);
  assert(FakeWS.instances.length >= 2, `recycled: ${FakeWS.instances.length}`);
  s.stop(); await sleep(30);
});
test('a throwing message handler does not kill the stream', async () => {
  FakeWS.instances = []; let n = 0;
  const s = new ManagedSocket({ urls: ['ws://t'], onMessage: () => { n++; throw new Error('boom'); }, onStatus: () => {} });
  s.start(); const w = FakeWS.instances[0]; w.open(); w.msg('a'); w.msg('b');
  assert(n === 2 && w.readyState === 1); s.stop(); await sleep(10);
});

section('Tick → candle aggregation (no fabricated bars)');
const H = 3600, t0 = 1_700_006_400;
const bar = (i: number, o = 100, h = 101, l = 99, c = 100): Candle => ({ time: t0 + i * H, open: o, high: h, low: l, close: c });
test('first tick opens an aligned bar; subsequent tick updates H/L/C only', () => {
  const a = applyTick([], { price: 1.1, timeSec: t0 + 1000 }, '1H')!;
  assert(a.candles.length === 1 && a.live.time === t0 && a.live.open === 1.1 && a.newBar);
  const b = applyTick(a.candles, { price: 1.12, timeSec: t0 + 2000 }, '1H')!;
  assert(b.candles.length === 1 && b.live.high === 1.12 && b.live.low === 1.1 && b.live.open === 1.1 && b.live.close === 1.12);
  const c = applyTick(b.candles, { price: 1.09, timeSec: t0 + 3000 }, '1H')!;
  assert(c.live.low === 1.09 && c.live.high === 1.12);
});
test('quiet period: a tick 5 bars later adds ONE bar — no filler candles invented', () => {
  const r = applyTick([bar(0)], { price: 100.5, timeSec: t0 + 5 * H + 10 }, '1H')!;
  assert(r.candles.length === 2 && r.live.time === t0 + 5 * H && r.newBar);
});
test('late, invalid and non-finite ticks are ignored', () => {
  assert(applyTick([bar(3)], { price: 1, timeSec: t0 }, '1H') === null);
  assert(applyTick([bar(3)], { price: NaN, timeSec: t0 + 4 * H }, '1H') === null);
  assert(applyTick([bar(3)], { price: -1, timeSec: t0 + 4 * H }, '1H') === null);
});
test('bars stay anchored to the PROVIDER boundary (e.g. daily bars opening 22:00 UTC)', () => {
  const dayOpen = 1_700_000_000 - (1_700_000_000 % 86400) + 22 * 3600;
  const r = applyTick([{ time: dayOpen, open: 1, high: 1, low: 1, close: 1 }], { price: 1.01, timeSec: dayOpen + 86400 + 100 }, '1D')!;
  assert(r.live.time === dayOpen + 86400, 'anchored');
});
test('volume only accumulates when the provider actually reports it', () => {
  const a = applyTick([], { price: 1, timeSec: t0 }, '1H')!; assert(a.live.volume === undefined);
  const b = applyTick(a.candles, { price: 1, timeSec: t0 + 5, volume: 3 }, '1H')!; assert(b.live.volume === 3);
});
test('24h stats are null unless history really covers 24h', () => {
  const short = Array.from({ length: 10 }, (_, i) => bar(i)); assert(compute24hStats(short, '1H', t0 + 10 * H) === null);
  const long = Array.from({ length: 48 }, (_, i) => bar(i, 100 + i, 101 + i, 99 + i, 100 + i)); const s = compute24hStats(long, '1H', t0 + 48 * H)!;
  assert(s && s.high === 101 + 47 && s.open > 100);
});

section('Provider parsing');
test('Binance combined-stream and raw frames (kline + ticker)', () => {
  const k = { e: 'kline', s: 'BTCUSDT', k: { t: 1700000000000, o: '1', h: '2', l: '0.5', c: '1.5', v: '10', x: true, i: '1h' } };
  for (const frame of [JSON.stringify({ stream: 'btcusdt@kline_1h', data: k }), JSON.stringify(k)]) {
    const p = parseBinanceFrame(frame).kline!;
    assert(p.closed && p.candle.time === 1700000000 && p.candle.high === 2 && p.symbol === 'BTCUSDT' && p.interval === '1h');
  }
  const t = parseBinanceFrame(JSON.stringify({ data: { e: '24hrTicker', s: 'ETHUSDT', c: '10', o: '9', h: '11', l: '8', v: '5', p: '1', P: '11.1', E: 1700000000123 } })).ticker!;
  assert(t.price === 10 && t.symbol === 'ETHUSDT' && t.eventMs === 1700000000123);
  assert(Object.keys(parseBinanceFrame('{"result":null,"id":1}')).length === 0);
  assert(combinedStreamUrls('BTCUSDT', '4H')[0].includes('/stream?streams=btcusdt@kline_4h/btcusdt@ticker'));
});
test('Twelve Data response parsing (UTC datetimes, no invented volume) and error surfacing', () => {
  const c = parseTwelveResponse({ status: 'ok', values: [{ datetime: '2026-10-26 14:00:00', open: '1.0801', high: '1.0812', low: '1.0795', close: '1.0808' }, { datetime: '2026-10-26', open: '1', high: '2', low: '1', close: '2', volume: '0' }] });
  assert(c[0].time === Date.UTC(2026, 9, 26, 14) / 1000 && c[0].volume === undefined && c[1].volume === undefined);
  assert(parseTwelveDatetime('2026-10-26') === Date.UTC(2026, 9, 26) / 1000);
  let threw = false; try { parseTwelveResponse({ status: 'error', code: 429, message: 'run out of API credits' }); } catch (e) { threw = /credits/.test((e as Error).message); }
  assert(threw, 'API error is surfaced, never swallowed as empty data');
});
test('candle merge helpers', () => {
  const a = [bar(0), bar(1)];
  assert(mergeCandle(a, bar(1, 100, 105, 99, 104))[1].high === 105 && mergeCandle(a, bar(2)).length === 3 && mergeCandle(a, bar(-5)).length === 2);
  const m = mergeCandleLists(a, [bar(1, 1, 2, 0.5, 1.5), bar(2)]); assert(m.length === 3 && m[1].open === 1);
});
test('fetchJson: retries 5xx, does not retry 4xx, rotates to the next mirror, honours abort', async () => {
  const calls: string[] = []; const orig = globalThis.fetch;
  globalThis.fetch = (async (u: string) => { calls.push(u); if (u.includes('bad')) return { ok: false, status: 503, json: async () => ({}) }; if (u.includes('forbidden')) return { ok: false, status: 403, json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ ok: 1 }) }; }) as never;
  try {
    assert((await fetchJson(['http://bad', 'http://good'], { retries: 1, retryDelayMs: 1 }) as { ok: number }).ok === 1);
    assert(calls.filter(c => c.includes('bad')).length === 2, '5xx retried once');
    calls.length = 0; await fetchJson(['http://forbidden', 'http://good'], { retries: 3, retryDelayMs: 1 });
    assert(calls.filter(c => c.includes('forbidden')).length === 1, '4xx not retried');
    const ctl = new AbortController(); ctl.abort(); let aborted = false; try { await fetchJson('http://good', { signal: ctl.signal }); } catch { aborted = true; } assert(aborted);
  } finally { globalThis.fetch = orig; }
});

section('News risk');
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0), MIN = 60000;
const ev = (title: string, currency: string, dMin: number, impact: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH') => ({ id: title, title, currency, time: NOW + dMin * MIN, impact, source: 't' });
test('no source at all → level "unknown" / NEWS DATA UNAVAILABLE (never defaults to low)', () => {
  const r = assessNewsRisk({ events: null, headlines: null, currencies: ['USD'], now: NOW });
  assert(r.level === 'unknown' && r.coverage === 'none' && /UNAVAILABLE/.test(r.drivers[0]));
});
test('BEFORE / DURING / AFTER phases and levels for a HIGH release', () => {
  const at = (d: number) => assessNewsRisk({ events: [ev('CPI', 'USD', d)], headlines: [], currencies: ['USD'], now: NOW });
  assert(at(30).level === 'high' && at(30).phase === 'BEFORE');
  assert(at(-10).level === 'high' && at(-10).phase === 'DURING');
  assert(at(-60).level === 'medium' && at(-60).phase === 'AFTER');
  assert(at(180).level === 'medium' && at(180).phase === 'BEFORE');
  assert(at(600).level === 'low' && at(-300).level === 'low');
});
test('only relevant currencies count: EURUSD sees EUR+USD, not JPY; gold sees USD', () => {
  const evs = [ev('BoJ Rate Decision', 'JPY', 20)];
  assert(assessNewsRisk({ events: evs, headlines: [], currencies: relevantCurrencies('EURUSD'), now: NOW }).level === 'low');
  assert(assessNewsRisk({ events: evs, headlines: [], currencies: relevantCurrencies('USDJPY'), now: NOW }).level === 'high');
  assert(relevantCurrencies('GOLD').join() === 'USD' && relevantCurrencies('BTC').join() === 'USD');
});
test('calendar missing: headlines-only coverage is declared, never silent', () => {
  const r = assessNewsRisk({ events: null, headlines: [], currencies: ['USD'], now: NOW });
  assert(r.coverage === 'headlines-only' && r.drivers.some(d => /calendar unavailable/i.test(d)));
});
test('calendar parsing drops holidays/unknown impact and bad dates', () => {
  const p = parseCalendar([{ title: 'NFP', country: 'USD', date: '2026-11-06T08:30:00-05:00', impact: 'High' }, { title: 'Bank Holiday', country: 'JPY', date: '2026-11-03T00:00:00-05:00', impact: 'Holiday' }, { title: 'x', country: 'USD', date: 'nope', impact: 'High' }]);
  assert(p.length === 1 && p[0].impact === 'HIGH' && p[0].time === Date.parse('2026-11-06T13:30:00Z'));
  let threw = false; try { parseCalendar({ not: 'an array' }); } catch { threw = true; } assert(threw);
});

section('Engine end-to-end');
const hist = randomWalk(400, 21, 100, 1.2);
const afterClose = hist[hist.length - 1].time + 3600 + 5;
test('analysis runs on closed candles only (forming bar excluded)', () => {
  const mid = hist[hist.length - 1].time + 1800;  // last bar still forming
  const r = runAnalysis(hist, 'TEST/USD', '1H', { nowSec: mid, decimals: 2, kind: 'crypto' })!;
  assert(r && r.asOf === hist[hist.length - 2].time, `asOf ${r.asOf}`);
  const r2 = runAnalysis(hist, 'TEST/USD', '1H', { nowSec: afterClose, kind: 'crypto' })!;
  assert(r2.asOf === hist[hist.length - 1].time);
});
test('result exposes evidence state, gates, no fabricated confidence; news defaults to UNAVAILABLE not low', () => {
  const r = runAnalysis(hist, 'TEST/USD', '1H', { nowSec: afterClose })!;
  assert(r.evidence && ['strong', 'moderate', 'weak', 'conflicting', 'insufficient'].includes(r.evidence.state));
  assert(r.evidence!.gates.length >= 8 && r.newsRisk === 'unknown' && r.newsRiskDetail!.coverage === 'none');
  assert(['BUY', 'SELL', 'WAIT', 'NO TRADE'].includes(r.decision));
  assert(r.volatility && r.momentum && r.breakouts && r.indicators.adx !== undefined && r.indicators.bbUpper !== undefined);
});
test('too little / bad data → NO TRADE with DATA UNAVAILABLE, nothing inferred', () => {
  const r = runAnalysis(hist.slice(0, 30), 'X', '1H', { nowSec: afterClose })!;
  assert(r.decision === 'NO TRADE' && r.unavailableReason && r.evidence!.state === 'insufficient' && r.tradeSetup === null);
  assert(generateOverlay(r).lines.length === 0);
  const holes = hist.filter((_, i) => i % 9 !== 0);                     // 11% missing bars on a 24/7 market
  const h = runAnalysis(holes, 'X', '1H', { nowSec: afterClose, kind: 'crypto' })!;
  assert(h.decision === 'NO TRADE' && /missing/i.test(h.unavailableReason ?? ''), h.unavailableReason);
});
test('FX series without real volume: VWAP/volume ratio are null, not invented', () => {
  const fx = hist.map(c => ({ ...c, volume: undefined }));
  const r = runAnalysis(fx, 'EUR/USD', '1H', { nowSec: afterClose, kind: 'fx', decimals: 5 })!;
  assert(r.indicators.vwap === null && r.indicators.volumeRatio === null);
});
test('floorTime excludes partial tick-built bars from analysis', () => {
  const r = runAnalysis(hist, 'X', '1H', { nowSec: afterClose, floorTime: hist[hist.length - 30].time })!;
  assert(r.unavailableReason !== undefined, 'only 30 bars remain → refused');
});
test('stale feed blocks BUY/SELL even with otherwise valid analysis', () => {
  const r = runAnalysis(hist, 'X', '1H', { nowSec: afterClose, feed: 'dead' })!;
  assert(r.decision !== 'BUY' && r.decision !== 'SELL');
});
test('FUZZ: 300 random series never throw and produce only finite, correctly-ordered levels', () => {
  const rnd = prng(99); let setups = 0, decisions: Record<string, number> = {};
  for (let k = 0; k < 300; k++) {
    const n = 20 + Math.floor(rnd() * 600), vol = 0.05 + rnd() * 5, start = 0.5 + rnd() * 5000;
    const cs = randomWalk(n, 1000 + k, start, vol * start / 100);
    const tfs = ['1m', '5m', '15m', '1H', '4H', '1D'] as const; const tf = tfs[k % tfs.length];
    const sec = { '1m': 60, '5m': 300, '15m': 900, '1H': 3600, '4H': 14400, '1D': 86400 }[tf];
    const re = cs.map((c, i) => ({ ...c, time: Math.floor(1_700_000_000 / sec) * sec + i * sec }));
    const r = runAnalysis(re, 'F', tf, { nowSec: re[re.length - 1].time + sec + 1, kind: k % 3 ? 'crypto' : 'fx', decimals: 4 });
    assert(r, 'result');
    decisions[r!.decision] = (decisions[r!.decision] ?? 0) + 1;
    for (const l of [...r!.supportLevels, ...r!.resistanceLevels]) assert(Number.isFinite(l.price), 'finite level');
    r!.supportLevels.forEach(s => assert(s.price < r!.lastPrice)); r!.resistanceLevels.forEach(s => assert(s.price > r!.lastPrice));
    const t = r!.tradeSetup;
    if (t) {
      setups++;
      assert([t.stopLoss, t.tp1, t.tp2, t.tp3, t.entry!, t.riskReward].every(Number.isFinite), 'finite setup');
      const long = t.direction === 'long';
      assert(long ? t.stopLoss < t.entry! && t.tp1 > t.entry! && t.tp2 > t.tp1 && t.tp3 > t.tp2 : t.stopLoss > t.entry! && t.tp1 < t.entry! && t.tp2 < t.tp1 && t.tp3 < t.tp2, 'ordering');
      assert(t.riskReward >= 1.5 && t.rrTp1! >= 1, 'R:R floors respected');
      assert(r!.decision === (long ? 'BUY' : 'SELL'), 'setup only on BUY/SELL');
    }
    assert(r!.decision !== 'BUY' && r!.decision !== 'SELL' || t, 'BUY/SELL always carries a plan');
  }
  console.log('      fuzz decisions:', JSON.stringify(decisions), 'setups:', setups);
});

done();
