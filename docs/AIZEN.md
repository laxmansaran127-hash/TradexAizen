# Aizen AI × TradeXLive — paper trading

**Status: PAPER TRADING ONLY.** No order is ever sent to an exchange or broker. Live auto-trading is
locked (`LIVE_TRADING_AVAILABLE = false` in `src/lib/aizen/types.ts`) because no execution connector exists
in this project. "Approval" mode also executes as a *simulated* paper order.

## Flow

```
market data (existing Binance / Twelve Data / Finnhub loaders)
  → runAnalysis() / decide() / buildTradePlan()      (existing deterministic engine, unchanged)
  → Aizen decision  (src/lib/aizen/bridge.ts: LONG / SHORT / WAIT / NO TRADE + evidence-based reasoning)
  → RISK GATE       (src/lib/aizen/risk.ts evaluateRisk — mandatory, cannot be bypassed)
  → paper executor  (src/lib/aizen/paperEngine.ts — simulated fills against real prices)
  → position monitor (closed candles only) → trade history → statistics
```

Aizen never re-decides: it only converts an engine verdict that already passed every engine gate and has a
complete plan. If anything is missing the result is NO TRADE / WAIT.

## Where things live

| Area | File |
|---|---|
| Types, live lock | `src/lib/aizen/types.ts` |
| Instruments, fee/slippage assumptions, USD conversion | `src/lib/aizen/instruments.ts` |
| Risk settings, hard limits, sizing, risk gate | `src/lib/aizen/risk.ts` |
| Paper engine, SL/TP management, approvals, Emergency STOP | `src/lib/aizen/paperEngine.ts` |
| Engine → decision bridge | `src/lib/aizen/bridge.ts` |
| Cycle orchestration (injectable data sources) | `src/lib/aizen/agent.ts`, real feeds in `feeds.ts` |
| Statistics / equity curve / period breakdown | `src/lib/aizen/stats.ts` |
| Persistence, restart recovery | `src/lib/aizen/store.ts` |
| Browser host (scheduler, actions) | `src/hooks/useAizenAgent.ts` |
| UI | `src/pages/AizenPage.tsx`, `src/components/aizen/*` (nav item "Aizen AI") |
| Headless worker (no browser tab needed) | `scripts/aizen-worker.ts` |
| Optional browser smoke test | `scripts/browser-smoke/` |
| Tests | `tests/aizen.test.ts` |

`src/lib/aizen/*` imports no React/DOM code, so it can run in a worker unchanged.

## Risk rules (all enforced by the gate; defaults are conservative)

Risk/trade 0.5 % · max daily loss 2 % · max drawdown 10 % · max 3 open positions · max 5 trades/day (UTC) ·
max 3 consecutive losses/day · min R:R 1.5 (recomputed from the expected fill) · max leverage 2× ·
max exposure 200 % · max entry drift 0.5 ATR · max spread 10 bps · news/calendar coverage required.
Values are clamped to hard ceilings (e.g. risk/trade ≤ 2 %, leverage ≤ 10×). Position size is always a fixed
fraction of **current** equity, so a losing streak can only shrink size — there is no recovery/martingale path.
Stale, missing or unavailable data → no trade (the candle is retried, not skipped, when data returns).

## Fill model (assumptions — not broker quotes)

Entry = latest real price ± slippage (crypto 2 bps, forex 0.5 bps, gold 1 bps); commission crypto 10 bps/side,
forex/gold 0 (cost is the spread); stops fill at the stop (or the open on a gap) with adverse slippage; targets fill
at the target. Exits are evaluated **once per closed candle**. Inside one candle the order of events is unknown, so the
model is pessimistic: stop before targets; a breakeven stop set by TP1 also counts if the same candle traded back
through it. Scale-out 50/30/20 % at TP1/TP2/TP3, stop to breakeven after TP1. Real results will differ.

## Running it

* **In the app:** open *Aizen AI* → switch the agent ON. It cycles every 30 s while the app is open (and keeps
  managing open positions even when the agent is OFF). Forex/gold need `VITE_TWELVEDATA_API_KEY` and/or
  `VITE_FINNHUB_API_KEY`; without data it reports it and does not trade.
* **24/7 without a browser:** `AIZEN_AGENT_ON=1 AIZEN_ASSETS=BTC,ETH npm run aizen:worker`
  (state in `aizen-paper-state.json`, atomic writes, graceful shutdown). Kill switch: `touch aizen-paper-state.json.STOP`.
  Run it under pm2/systemd/Docker for restarts. Browser and worker keep **separate** accounts — see the section below.
* **Tests:** `npm test` (all offline).

## Two SEPARATE paper accounts (browser vs worker) — no synchronisation

| | Browser account | Worker account |
|---|---|---|
| Where it lives | this browser's `localStorage`, key `tradex:aizen:paper:v1` | the JSON file `AIZEN_STATE_FILE` (default `./aizen-paper-state.json`) |
| Who runs it | the open app (30 s cycles) | `npm run aizen:worker` |
| Shared with the other? | **No.** Different balance, positions, history, settings and idempotency keys. Nothing copies data between them. | **No.** |
| Lost when | site data is cleared / another browser or device is used / private window closes | the file is deleted (a corrupt file is kept as `*.corrupt` and a fresh account starts) |

Running both at the same time simulates two independent traders (they can hold the same signal at once). Pick one for
any account you want to evaluate. To view worker results, open the JSON file; the app does not read it.

Guards that exist:
* **Several tabs of the app** share one browser account. A lock in localStorage (`tradex:aizen:agent-lock:v1`, 90 s TTL,
  refreshed every cycle) lets only one tab run the agent; the others show "running in another tab" and mirror the
  shared state through the `storage` event. User actions in any tab (e.g. Emergency STOP) are adopted by the others, and a
  cycle that was running during such a change is discarded rather than overwriting it. The lock is best-effort: two tabs
  started in the same millisecond can both win once; the next cycle resolves it.
* **Two workers on one file:** `<state file>.lock` holds the PID; a second worker exits; a lock left by a dead process is replaced.
* **Browser storage size:** decisions (150), risk events (200) and execution-log lines (300) are capped; trades are kept in
  full. If the browser refuses to save (quota/blocked) the page shows a warning. Use the CSV export to archive history.

## Dependencies, checks and what was verified

* `tsx` is a declared dev dependency (`"tsx": "^4.23.12"` in `package.json`, locked in `package-lock.json` as
  `tsx@4.23.12` with its own nested `esbuild@0.28.2` + 26 `@esbuild/*` platform packages, next to Vite's `esbuild@0.21.5`).
  `npm test` (via `tests/run.sh`) and `npm run aizen:worker` use it.
* **Provenance of those 28 lock entries (read this once):** the project was prepared on a machine without access to
  registry.npmjs.org, so they were not produced by `npm install` against the public registry. The `version` and
  `integrity` (sha512) values were copied unchanged from a real lockfile of an actual `tsx@4.23.12` install on the build
  machine (which had fetched it through an internal npm mirror); only the `resolved` URLs were rewritten to the canonical
  `https://registry.npmjs.org/...` form. Nothing was computed or invented, but the hashes were **not** compared against the
  public registry. `npm ci` verifies every tarball against these hashes: if one ever differs it stops with `EINTEGRITY`
  and installs nothing. If that happens, run `npm install` once (it rewrites those entries from the registry) and commit
  the result.
* Full check sequence after a clean install: `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.
* Optional real-browser smoke test (not part of `npm test`; needs `npm i -D playwright` and a browser, see the header of
  `scripts/browser-smoke/run.ts`): bundles the real hook + page, drives Chromium with faked time and intercepted market-data
  requests (deterministic TEST fixtures from `tests/harness.ts`, never shipped in the app).

## What is NOT implemented (and why)

* **Live trading / broker connectors.** No order-execution connector exists in the project (only market data).
  Needed before live: a server-side connector with trade-only API keys (never withdrawal), idempotent client order ids,
  fill/partial-fill/rejection handling, broker position reconciliation, and a server-side worker with its own secrets.
  Nothing in the frontend may hold those keys.
* **Supabase persistence.** The existing schema has open anon policies and the app has no sign-in, so per-user RLS
  tables cannot be made meaningful yet. No migration was added. Add authentication first, then tables for
  accounts/settings/orders/positions/trades/decisions/risk events/execution logs with `auth.uid() = user_id` policies.
* **Real bid/ask spread.** No quote feed with bid/ask exists; the spread filter uses a declared assumed value and says so.
* **Aizen chat / voice read-aloud.** These do not exist in this codebase (the separate `Aizen_AI.html` is unrelated).
