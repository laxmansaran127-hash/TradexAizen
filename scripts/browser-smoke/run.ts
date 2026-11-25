/**
 * Optional real-browser smoke test for the Aizen page (NOT part of `npm test`).
 *
 * Bundles the REAL useAizenAgent hook + AizenPage with esbuild, loads them in Chromium (StrictMode, React dev
 * build so warnings are visible) and drives the UI. Market-data HTTP requests are intercepted and answered with
 * deterministic TEST fixtures (the generator in tests/harness.ts) — fixtures exist only inside this test.
 * Time is faked (Playwright clock) so hours can pass in seconds.
 *
 *   npm i -D playwright            # plus a browser:  npx playwright install chromium
 *   npx tsx --tsconfig tests/tsconfig.json scripts/browser-smoke/run.ts
 *
 * Env: ESBUILD_BIN (default node_modules/.bin/esbuild), PLAYWRIGHT_MODULE (default "playwright"),
 *      PLAYWRIGHT_CHROMIUM (path to a chrome binary), AIZEN_SMOKE_STUB_ICONS=1 (when lucide-react is not installed).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomWalk } from '../../tests/harness';
import { buildDecision } from '../../src/lib/aizen/bridge';
import { createInitialState, processDecision } from '../../src/lib/aizen/paperEngine';
import { runAnalysis } from '../../src/lib/analysis/engine';
import { ASSET_CONFIGS } from '../../src/types/trading';
import type { AizenState, TradeRecord } from '../../src/lib/aizen/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const ROOT = resolve(import.meta.dirname ?? '.', '../..');
const H = 3600;
const T0 = Date.UTC(2026, 10, 5, 10, 20, 0);                       // fake "now" (ms)
const L0 = Math.floor(T0 / 1000 / H) * H - H;                      // open of the last CLOSED 1H candle at T0
const NEWS_EMPTY = '[]';                                           // calendar reachable, no events ⇒ coverage "calendar"
const KEY = 'tradex:aizen:paper:v1';

// ── fixtures (TEST DATA) ────────────────────────────────────────
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const baseSeries = (symbol: string): Bar[] => {
  const raw = randomWalk(300, symbol === 'BTCUSDT' ? 89 : 7, 100, 1);
  return raw.map((c, i) => ({ ...c, time: L0 - (299 - i) * H }));
};
let extraBtc: Bar[] = [];
const klineRows = (symbol: string): (string | number)[][] =>
  [...baseSeries(symbol), ...(symbol === 'BTCUSDT' ? extraBtc : [])].slice(-300).map(c => [c.time * 1000, c.open, c.high, c.low, c.close, c.volume, 0, 0, 0, 0, 0, 0]);

// ── tiny assertion collector ────────────────────────────────────
const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `  — ${detail}`}`); };

async function main(): Promise<void> {
  // 1) bundle
  const out = mkdtempSync(join(tmpdir(), 'aizen-smoke-'));
  const esbuild = process.env.ESBUILD_BIN || join(ROOT, 'node_modules/.bin/esbuild');
  const args = [join(ROOT, 'scripts/browser-smoke/entry.tsx'), '--bundle', `--outfile=${out}/bundle.js`, '--format=iife', '--jsx=automatic',
    '--define:process.env.NODE_ENV="development"', '--define:import.meta.env={}', `--alias:@=${join(ROOT, 'src')}`, '--log-level=warning'];
  if (process.env.AIZEN_SMOKE_STUB_ICONS === '1') args.push(`--alias:lucide-react=${join(ROOT, 'scripts/browser-smoke/icon-stub.tsx')}`);
  execFileSync(esbuild, args, { stdio: 'inherit' });
  writeFileSync(join(out, 'index.html'), '<!doctype html><html><body style="background:#0b1220;color:#e2e8f0"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(join(out, 'bundle.js'))); }
    else { res.setHeader('content-type', 'text/html'); res.end(readFileSync(join(out, 'index.html'))); }
  });
  await new Promise<void>(r => { server.listen(0, '127.0.0.1', () => r()); });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/`;

  // 2) browser
  const pw: Any = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser: Any = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const problems: string[] = [];
  let klineCalls = 0, calendarCalls = 0, external = 0;

  async function newContext(initState?: AizenState): Promise<Any> {
    const ctx: Any = await browser.newContext({ acceptDownloads: true });
    await ctx.clock.install({ time: T0 });
    if (initState) await ctx.addInitScript(`if (!localStorage.getItem(${JSON.stringify(KEY)})) localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(initState))});`);
    await ctx.route('**/*', (route: Any) => {
      const u: string = route.request().url();
      const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
      if (u.startsWith(url)) return route.continue();
      if (u.includes('/api/v3/klines')) { klineCalls++; const sym = new URL(u).searchParams.get('symbol') ?? ''; return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(klineRows(sym)) }); }
      if (u.includes('ff_calendar_thisweek')) { calendarCalls++; return route.fulfill({ status: 200, headers: cors, body: NEWS_EMPTY }); }
      external++; return route.abort();
    });
    return ctx;
  }
  const watch = (page: Any, tag: string) => {
    page.on('pageerror', (e: Error) => problems.push(`[${tag}] pageerror: ${e.message}`));
    page.on('console', async (m: Any) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      const parts: unknown[] = await Promise.all(m.args().map((x: Any) => x.jsonValue().catch(() => '?')));
      problems.push(`[${tag}] console.${m.type()}: ${parts.join(' ').slice(0, 1500)}`);
    });
  };
  const state = (page: Any): Promise<AizenState> => page.evaluate((k: string) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  const text = (page: Any): Promise<string> => page.evaluate(() => document.body.innerText);
  const until = async (page: Any, fn: (s: AizenState | null, t: string) => boolean, ms = 15000): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn(await state(page), await text(page))) return true; await new Promise(r => setTimeout(r, 150)); }
    return false;
  };

  // ════════ PHASE 1 — live flow: agent ON → paper position → reload → 2nd tab → STOP → stop-out ════════
  console.log('\nPhase 1: autonomous paper cycle in a real browser (StrictMode, React dev build)');
  const ctx = await newContext();
  const p1: Any = await ctx.newPage(); watch(p1, 'tab1');
  await p1.goto(url);
  let t = await text(p1);
  check('page renders (control panel, PAPER badge, agent OFF)', t.includes('PAPER · SIMULATED · NO REAL MONEY') && t.includes('Agent OFF') && t.includes('EMERGENCY STOP'));
  check('Live auto trading button is locked & disabled', await p1.getByRole('button', { name: /Live auto — LOCKED/ }).isDisabled());
  check('no market-data requests while the agent is OFF', klineCalls === 0, `klines=${klineCalls}`);

  await p1.getByRole('button', { name: /Agent OFF/ }).click();
  const opened = await until(p1, (s) => !!s && s.positions.length === 1);
  let s = await state(p1);
  check('agent ON → exactly ONE paper position opened under StrictMode (no double-open)', opened && s.positions.length === 1, `positions=${s?.positions.length}`);
  check('position is BTC LONG with risk ≤ 0.5% of equity', !!s && s.positions[0]?.assetId === 'BTC' && s.positions[0].direction === 'long' && s.positions[0].riskUsd <= 50.0001, JSON.stringify(s?.positions[0]?.riskUsd));
  check('ETH (no engine signal) produced no position, a decision was recorded', !!s && !s.positions.some(p => p.assetId === 'ETH') && s.decisions.some(d => d.decision.assetId === 'ETH'));
  check('every decision carries reasoning; BTC decision executed_paper', !!s && s.decisions.every(d => d.decision.reasoning.length > 0) && s.decisions.some(d => d.decision.assetId === 'BTC' && d.outcome === 'executed_paper'));
  check('storage tagged paper, live mode never persisted', !!s && s.accountType === 'paper' && s.settings.mode === 'paper');
  check('calendar + klines fetched through the page', calendarCalls > 0 && klineCalls > 0, `cal=${calendarCalls} klines=${klineCalls}`);
  await until(p1, (_s, tx) => tx.includes('Active paper positions') && tx.includes('BTC/USDT') && tx.includes('LONG'));
  t = await text(p1);
  check('UI shows position row, decisions list and risk KPIs', t.includes('Active paper positions') && t.includes('BTC/USDT') && t.includes('executed paper') && t.includes('Paper equity') && t.includes('Daily loss'));
  await p1.getByText('BTC/USDT').last().click().catch(() => undefined);

  // restart recovery
  await p1.reload();
  await new Promise(r => setTimeout(r, 2500));
  s = await state(p1);
  t = await text(p1);
  check('reload: position, history and idempotency keys restored; nothing duplicated', !!s && s.positions.length === 1 && s.seenOrderKeys.length === 1 && t.includes('BTC/USDT'), `pos=${s?.positions.length} keys=${s?.seenOrderKeys.length}`);

  // second tab
  const p2: Any = await ctx.newPage(); watch(p2, 'tab2');
  await p2.goto(url);
  const banner = await until(p2, (_s, tx) => tx.includes('running in another tab'));
  const before = await state(p2);
  await new Promise(r => setTimeout(r, 1500));
  const after = await state(p2);
  check('2nd tab shows "running in another tab" and does not start a 2nd agent', banner && after.positions.length === 1 && after.decisions.length === before.decisions.length);
  await p2.getByRole('button', { name: /EMERGENCY STOP/ }).click();
  const synced = await until(p1, (st, tx) => !!st && st.settings.emergencyStopped && tx.includes('Emergency STOP is active'));
  s = await state(p1);
  check('EMERGENCY STOP in tab 2 reaches tab 1 (storage sync), agent OFF, position kept & protected', synced && !s.settings.agentOn && s.positions.length === 1);
  await p2.close();
  await p1.getByRole('button', { name: /Clear STOP/ }).click();
  s = await state(p1);
  check('clear STOP is explicit and leaves the agent OFF', !s.settings.emergencyStopped && !s.settings.agentOn);

  // stop-out: 3 hours later the market crashed through the stop (fixture); agent is OFF but positions are still managed
  const stop = s.positions[0].stop, px = baseSeries('BTCUSDT')[299].close;
  const mk = (i: number, o: number, h: number, l: number, c: number): Bar => ({ time: L0 + i * H, open: o, high: h, low: l, close: c, volume: 1 });
  extraBtc = [mk(1, px, px * 1.001, px * 0.999, px), mk(2, px, px, stop - 5, stop - 4), mk(3, stop - 4, stop - 3, stop - 6, stop - 5)];
  await ctx.clock.fastForward('03:00:00');
  const closed = await until(p1, (st) => !!st && st.trades.length === 1 && st.positions.length === 0, 20000);
  s = await state(p1);
  const tr: TradeRecord | undefined = s.trades[0];
  check('agent OFF still manages the open position: stop hit → trade saved', closed && tr?.outcome === 'loss' && tr.exitReason === 'stop', JSON.stringify(tr && [tr.outcome, tr.exitReason]));
  check('trade is PAPER / filled_paper with fees, reasoning and a ledger-consistent balance', !!tr && tr.accountType === 'paper' && tr.executionStatus === 'filled_paper' && tr.fees > 0 && tr.reasoning.length > 0 &&
    Math.abs(s.account.balance - (s.account.startingEquity + tr.realizedPnl)) < 1e-6, `balance=${s.account.balance}`);
  await until(p1, (_s, tx) => tx.includes('LOSS') && tx.includes('PAPER'));
  t = await text(p1);
  check('history table + stats rendered (PAPER badge, LOSS, Total trades)', t.includes('PAPER ACCOUNT — SIMULATED TRADES ONLY') && t.includes('LOSS') && t.includes('Total trades') && t.includes('Max drawdown'));
  await ctx.close();

  // ════════ PHASE 2 — approval card, history widgets, CSV export, reset (state preloaded via core lib) ════════
  console.log('\nPhase 2: approval queue + full history UI');
  extraBtc = [];                                                   // phase 2 starts from the original (pre-crash) market
  const cfg = ASSET_CONFIGS.find(a => a.id === 'BTC')!;
  const series = baseSeries('BTCUSDT') as unknown as Parameters<typeof runAnalysis>[0];
  const analysis = runAnalysis(series, 'BTC/USDT', '1H', { kind: 'crypto', decimals: 2, feed: 'fresh', news: { level: 'low', phase: null, drivers: [], coverage: 'calendar' }, nowSec: Math.floor(T0 / 1000) });
  const decision = buildDecision(analysis, cfg, '1H', 'fresh', Math.floor(T0 / 1000));
  const seed = createInitialState({ mode: 'approval', agentOn: false, assets: ['BTC'], markets: { crypto: true, forex: false, gold: false } });
  const last = series[series.length - 1].close;
  processDecision(seed, decision, { nowSec: Math.floor(T0 / 1000), prices: { BTC: last }, livePrice: last, spreadBps: null });
  const mkTrade = (i: number, pnl: number, outcome: TradeRecord['outcome']): TradeRecord => ({
    id: `seed${i}`, accountType: 'paper', assetId: 'BTC', symbol: 'BTC/USDT', category: 'crypto', direction: i % 2 ? 'short' : 'long', entryPrice: 100, exitPrice: 101, stopLoss: 98,
    takeProfit: { tp1: 103, tp2: 106, tp3: 109 }, qty: 1, leverage: 1, entryTime: 1_790_000_000 + i * 90_000, exitTime: 1_790_000_600 + i * 90_000, grossPnl: pnl, fees: 1, realizedPnl: pnl,
    outcome, rMultiple: pnl / 50, strategy: 'seed', timeframe: '1H', reasoning: ['seeded history row'], executionStatus: 'filled_paper', exitReason: 'stop', decisionId: 'x',
    legs: [{ time: 1_790_000_600 + i * 90_000, price: 101, qty: 1, reason: 'stop', fee: 1, pnl }],
  });
  seed.trades = [mkTrade(0, 120, 'win'), mkTrade(1, -50, 'loss'), mkTrade(2, 0, 'breakeven'), mkTrade(3, 75, 'win')];
  seed.account.balance += 145; seed.account.peakEquity = seed.account.balance + 5;
  check('fixture: core created a pending approval from the real engine decision', seed.pending.length === 1, `decision=${decision.decision}`);

  const ctx2 = await newContext(seed);
  const q: Any = await ctx2.newPage(); watch(q, 'phase2');
  await q.goto(url);
  await until(q, (_s, tx) => tx.includes('Awaiting your approval'));
  t = await text(q);
  check('approval card renders with levels, size/risk and buttons', t.includes('Awaiting your approval') && t.includes('Approve (paper)') && t.includes('Decline') && t.includes('R:R'));
  check('history: stats, period tables, rows (WIN/LOSS/BREAKEVEN), PAPER badges', t.includes('Win rate') && t.includes('Profit factor') && t.includes('WIN') && t.includes('LOSS') && t.includes('BREAKEVEN') && t.includes('Daily') && t.includes('Weekly'));
  await q.getByRole('button', { name: 'Weekly' }).click(); await q.getByRole('button', { name: 'Monthly' }).click();
  await q.getByText('seeded history row').count();
  await q.locator('tbody tr').filter({ hasText: 'BTC/USDT' }).last().click();
  await until(q, (_s, tx) => tx.includes('seeded history row'));
  check('history row expands (fills + reasoning)', (await text(q)).includes('Fills:') && (await text(q)).includes('seeded history row'));
  const dl = q.waitForEvent('download');
  await q.getByRole('button', { name: /CSV/ }).click();
  const csv = readFileSync(await (await dl).path(), 'utf8');
  check('CSV export is tagged PAPER (simulated) and includes all trades', csv.includes('PAPER (simulated)') && csv.split('\n').length === 5, `lines=${csv.split('\n').length}`);
  await q.getByRole('button', { name: /Approve \(paper\)/ }).click();
  const approved = await until(q, (st) => !!st && st.positions.length === 1 && st.pending.length === 0);
  s = await state(q);
  check('Approve → risk gate re-run → simulated paper position opened', approved && s.decisions.some(d => d.outcome === 'approved'), JSON.stringify({ pos: s.positions.length, pend: s.pending.length, last: s.decisions.slice(-2).map(d => [d.outcome, d.rejectReasons]), notice: (await text(q)).match(/(Approval rejected|Cannot approve)[^\n]*/)?.[0] }));
  check('Risk settings panel opens and edits are clamped (risk/trade 50 → 2)', await (async () => {
    await q.getByRole('button', { name: /Risk settings/ }).click();
    const inp = q.locator('label', { hasText: 'Risk per trade' }).locator('input');
    await inp.fill('50'); await inp.blur();
    return (await state(q)).settings.risk.riskPerTradePct === 2;
  })());
  q.on('dialog', (d: Any) => d.accept());
  await q.getByRole('button', { name: /Reset paper account/ }).click();
  s = await state(q);
  check('Reset paper account clears trades & positions, agent OFF, settings kept', s.trades.length === 0 && s.positions.length === 0 && !s.settings.agentOn && s.settings.mode === 'approval');
  await ctx2.close();

  await new Promise(r => setTimeout(r, 300));
  await browser.close(); server.close();
  check('no unexpected external requests (everything else was blocked)', external === 0, `external=${external}`);
  check('no page errors / console errors / React warnings in either phase', problems.length === 0, problems.slice(0, 5).join(' || '));
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} browser checks passed`);
  if (problems.length) console.log('Problems:\n' + problems.join('\n'));
  process.exit(bad.length ? 1 : 0);
}

main().catch(e => { console.error('SMOKE TEST CRASHED:', e); process.exit(2); });
