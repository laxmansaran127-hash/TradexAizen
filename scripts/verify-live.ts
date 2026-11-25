/**
 * TradeX live-data verification. Runs against the REAL providers (needs network).
 *
 *   VITE_FINNHUB_API_KEY=... VITE_TWELVEDATA_API_KEY=... npx tsx --tsconfig tests/tsconfig.json scripts/verify-live.ts
 *   add --full to test every FX timeframe on Twelve Data (slow: free tier allows 8 calls/min)
 *
 * It checks, per asset and timeframe: connectivity, candle validity (OHLC/dupes/gaps/alignment),
 * freshness of the newest candle, price cross-checks between independent sources, live WebSocket
 * frames, calendar availability, and finally runs the analysis engine on the real series.
 * Exit code 1 if any check FAILS. "SKIP" means a prerequisite (key / network) was missing.
 */
import type { Candle, Timeframe } from '../src/types/trading';
import { TF_SECONDS } from '../src/types/trading';
import { fetchBinanceKlines, parseBinanceFrame, combinedStreamUrls, BINANCE_REST_HOSTS } from '../src/lib/data/binance';
import { FX_INSTRUMENTS, loadFxHistory, finnhubWsUrl, hasFinnhubKey, applyTick, type FxInstrumentId } from '../src/lib/data/fxProviders';
import { sanitizeCandles, assessSeriesHealth } from '../src/lib/data/validation';
import { fetchCalendar } from '../src/lib/news/calendar';
import { fetchJson } from '../src/lib/data/http';
import { runAnalysis } from '../src/lib/analysis/engine';

const TFS: Timeframe[] = ['1m', '5m', '15m', '30m', '1H', '4H', '1D'];
const CRYPTO = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'BCHUSDT', 'LTCUSDT'];
const FULL = process.argv.includes('--full');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0, skip = 0;
const ok = (n: string, d = '') => { pass++; console.log(`  PASS  ${n}${d ? '  — ' + d : ''}`); };
const bad = (n: string, d: string) => { fail++; console.log(`  FAIL  ${n}  — ${d}`); };
const skp = (n: string, d: string) => { skip++; console.log(`  SKIP  ${n}  — ${d}`); };

function checkSeries(label: string, tf: Timeframe, raw: Candle[], continuous: boolean, maxJump: number, maxAgeBars: number) {
  const now = Math.floor(Date.now() / 1000);
  const r = sanitizeCandles(raw, { timeframe: tf, continuous, maxJump });
  const health = assessSeriesHealth(r, { minCandles: 50, continuous });
  const errors = r.issues.filter(i => i.severity === 'error');
  const last = r.candles[r.candles.length - 1];
  const ageBars = last ? (now - last.time) / TF_SECONDS[tf] : Infinity;
  if (errors.length) bad(`${label} ${tf} validity`, `${errors.length} invalid candle(s): ${[...new Set(errors.map(e => e.code))].join(',')}`);
  else if (health.level === 'unusable') bad(`${label} ${tf} health`, health.reasons.join('; '));
  else if (ageBars > maxAgeBars) bad(`${label} ${tf} freshness`, `newest candle is ${ageBars.toFixed(1)} bars old (limit ${maxAgeBars})`);
  else ok(`${label} ${tf}`, `${r.candles.length} candles, health ${health.level}${health.reasons.length ? ' (' + health.reasons.join('; ') + ')' : ''}, newest ${ageBars.toFixed(2)} bars old`);
  return r.candles;
}

async function crypto() {
  console.log('\n[1] Binance crypto: REST candles, all timeframes');
  for (const sym of CRYPTO) {
    let hourly: Candle[] = [];
    for (const tf of TFS) {
      try {
        const c = await fetchBinanceKlines(sym, tf, 500, undefined);
        const clean = checkSeries(sym, tf, c, true, 0.5, 2);
        if (tf === '1H') hourly = clean;
      } catch (e) { bad(`${sym} ${tf} REST`, (e as Error).message); }
    }
    try { // independent price cross-check: last candle close vs spot ticker
      const t = await fetchJson(BINANCE_REST_HOSTS.map(h => `${h}/api/v3/ticker/price?symbol=${sym}`)) as { price: string };
      const spot = parseFloat(t.price), last = hourly[hourly.length - 1]?.close;
      if (last && Math.abs(spot / last - 1) < 0.03) ok(`${sym} price cross-check`, `spot ${spot} vs last 1H close ${last}`);
      else bad(`${sym} price cross-check`, `spot ${spot} vs last 1H close ${last}`);
    } catch (e) { bad(`${sym} ticker`, (e as Error).message); }
    // engine on the real series
    if (hourly.length >= 50) {
      try {
        const r = runAnalysis(hourly, sym, '1H', { kind: 'crypto', decimals: 2 });
        r && !r.unavailableReason ? ok(`${sym} engine`, `${r.decision} · evidence ${r.evidence?.state} · trend ${r.trend} · structure ${r.structure.state}`) : bad(`${sym} engine`, r?.unavailableReason ?? 'null');
      } catch (e) { bad(`${sym} engine`, (e as Error).message); }
    }
  }

  console.log('\n[2] Binance WebSocket (BTCUSDT 1m, 15s)');
  const WS = (globalThis as unknown as { WebSocket?: new (u: string) => any }).WebSocket;
  if (!WS) return skp('WebSocket', 'needs Node 22+');
  await new Promise<void>(resolve => {
    const urls = combinedStreamUrls('BTCUSDT', '1m'); let idx = 0, klines = 0, tickers = 0, closed = false;
    const open = () => {
      const ws = new WS(urls[idx % urls.length]);
      const timer = setTimeout(() => { closed = true; ws.close(); finish(); }, 15000);
      const finish = () => {
        clearTimeout(timer);
        klines >= 3 && tickers >= 3 ? ok('BTCUSDT live stream', `${klines} kline + ${tickers} ticker frames in 15s via ${urls[idx % urls.length].slice(0, 36)}…`) : bad('BTCUSDT live stream', `only ${klines} kline / ${tickers} ticker frames`);
        resolve();
      };
      ws.onmessage = (m: { data: string }) => { try { const f = parseBinanceFrame(String(m.data)); if (f.kline && f.kline.interval === '1m') klines++; if (f.ticker) tickers++; } catch { /* ignore */ } };
      ws.onerror = () => { if (!closed) { idx++; clearTimeout(timer); ws.close(); if (idx < urls.length * 2) open(); else { bad('BTCUSDT live stream', 'all mirrors failed'); resolve(); } } };
    };
    open();
  });
}

async function fx() {
  console.log('\n[3] Gold + forex (Finnhub live ticks, Twelve Data / Finnhub history)');
  const hasTwelve = !!process.env.VITE_TWELVEDATA_API_KEY;
  if (!hasFinnhubKey() && !hasTwelve) return skp('forex/gold', 'set VITE_FINNHUB_API_KEY and/or VITE_TWELVEDATA_API_KEY');
  const ids = Object.keys(FX_INSTRUMENTS) as FxInstrumentId[];
  const tfs = FULL ? TFS : (['15m', '1H', '1D'] as Timeframe[]);
  const lastClose: Partial<Record<FxInstrumentId, number>> = {};
  for (const id of ids) {
    const inst = FX_INSTRUMENTS[id];
    for (const tf of tfs) {
      try {
        const { candles, source } = await loadFxHistory(inst, tf);
        // FX markets close at weekends: allow a longer age window for intraday bars
        const clean = checkSeries(`${inst.displaySymbol} [${source}]`, tf, candles, false, inst.maxJump, tf === '1D' ? 4 : 60);
        if (tf === '1H' && clean.length) lastClose[id] = clean[clean.length - 1].close;
        if (tf === '1H' && clean.length >= 50) {
          const r = runAnalysis(clean, inst.displaySymbol, '1H', { kind: inst.kind === 'fx' ? 'fx' : 'metal', decimals: inst.decimals, maxJump: inst.maxJump });
          r && !r.unavailableReason ? ok(`${inst.displaySymbol} engine`, `${r.decision} · evidence ${r.evidence?.state} · structure ${r.structure.state}`) : bad(`${inst.displaySymbol} engine`, r?.unavailableReason ?? 'null');
        }
      } catch (e) { bad(`${inst.displaySymbol} ${tf} history`, (e as Error).message); }
      if (hasTwelve) await sleep(FULL ? 8000 : 2500); // respect free-tier rate limit
    }
  }
  if (!hasFinnhubKey()) return skp('Finnhub live ticks', 'no Finnhub key');
  console.log('\n[4] Finnhub WebSocket: 4 instruments, 25s (forex is quiet on weekends — zero ticks then is expected)');
  const WS = (globalThis as unknown as { WebSocket?: new (u: string) => any }).WebSocket;
  if (!WS) return skp('Finnhub WS', 'needs Node 22+');
  await new Promise<void>(resolve => {
    const ws = new WS(finnhubWsUrl()); const seen: Record<string, number[]> = {}; let err = '';
    ws.onopen = () => ids.forEach(id => ws.send(JSON.stringify({ type: 'subscribe', symbol: FX_INSTRUMENTS[id].finnhubSymbol })));
    ws.onmessage = (m: { data: string }) => { try { const d = JSON.parse(String(m.data)); if (d.type === 'trade') for (const t of d.data) (seen[t.s] ||= []).push(t.p); if (d.type === 'error') err = d.msg; } catch { /* ignore */ } };
    ws.onerror = () => { err = err || 'socket error'; };
    setTimeout(() => {
      ws.close();
      const weekend = [0, 6].includes(new Date().getUTCDay());
      for (const id of ids) {
        const inst = FX_INSTRUMENTS[id], ticks = seen[inst.finnhubSymbol] ?? [];
        if (ticks.length) {
          const last = ticks[ticks.length - 1], ref = lastClose[id];
          const agg = applyTick([], { price: last, timeSec: Math.floor(Date.now() / 1000) }, '1m');
          ref && Math.abs(last / ref - 1) < 0.01 && agg ? ok(`${inst.displaySymbol} live ticks`, `${ticks.length} ticks, last ${last} vs 1H close ${ref} (independent sources agree within 1%)`) : bad(`${inst.displaySymbol} live ticks`, `last ${last} vs history ${ref}`);
        } else weekend ? skp(`${inst.displaySymbol} live ticks`, 'no ticks (weekend)') : bad(`${inst.displaySymbol} live ticks`, err || 'no trades received in 25s');
      }
      resolve();
    }, 25000);
  });
}

async function news() {
  console.log('\n[5] Economic calendar');
  try { const ev = await fetchCalendar(); ev.length ? ok('calendar', `${ev.length} HIGH/MEDIUM/LOW events parsed, next: ${ev.find(e => e.time > Date.now())?.title ?? 'none this week'}`) : bad('calendar', 'parsed zero events'); }
  catch (e) { bad('calendar', `${(e as Error).message} (browser CORS may differ — set VITE_CALENDAR_URL to your own proxy)`); }
}

(async () => {
  console.log(`TradeX live verification · ${new Date().toISOString()} · ${FULL ? 'FULL' : 'quick'} mode`);
  await crypto(); await fx(); await news();
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail ? 1 : 0);
})();
