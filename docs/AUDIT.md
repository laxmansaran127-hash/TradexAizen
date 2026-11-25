# TradeX production audit

## Not verified in the audit environment
The audit sandbox had **no outbound network** and a partial `node_modules` (no Vite/ESLint/React/lucide/lightweight-charts).
Therefore NOT run: `vite build`, ESLint, the browser UI, or any live provider call.
Run on your machine: `npm ci && npm run build && npm run lint`, `bash tests/run.sh`, and
`VITE_FINNHUB_API_KEY=… VITE_TWELVEDATA_API_KEY=… npx tsx --tsconfig tests/tsconfig.json scripts/verify-live.ts [--full]`
(checks every crypto asset × 7 timeframes, FX/gold history + live ticks, cross-source prices, WebSocket frames, calendar, engine on real series).

What WAS run: 71 offline tests (indicators vs reference values, validation, structure, liquidity, S/R, breakouts, trade plan,
decision gates, socket lifecycle with a fake WebSocket, tick aggregation, parsers, news risk, engine end-to-end, 300-series fuzz);
whole-project TypeScript check (strict) with stubs only for uninstalled third-party typings (0 errors outside stub artifacts);
esbuild bundle of the full app graph (58 files).

## Critical findings (fixed)
1. **Forex data was synthetic.** EUR/USD, GBP/USD, USD/JPY charts were Binance EURUSDT candles scaled by a daily FX rate
   (types file mapped GBPUSD→EURGBP, USDJPY→BTCJPY). Removed. Now Finnhub live ticks + real history (Twelve Data → Finnhub).
2. **Duplicate-WebSocket race**: per-hook shared `shouldReconnect` flag let a closed socket reconnect after rapid switching.
   Replaced by `ManagedSocket` (generation guard, single timer, jittered backoff, stale watchdog, mirror rotation).
3. **Ticker never updated** (`if (!isMountedRef.current) setTicker`, inverted). **Asset switch didn't reload candles** (effect keyed on timeframe only).
4. **RSI math bug**: Wilder smoothing continued from the raw sum, skewing every value after the first. Fixed, verified against reference series.
5. **Short-side R:R was negative**; targets were fixed R-multiples; stop ignored structure. Rebuilt on structure/ATR with labelled projections.
6. **`newsRisk` hard-coded `'low'`**. Now computed from calendar + headlines, `unknown`/"NEWS DATA UNAVAILABLE" when no source.
7. **Fake confidence**: pattern `confidence` constants displayed as %. Replaced by evidence state + explicit gates.
8. **CHOCH/BOS labelled from single HL/LH swings**; `resistance[0]` was the highest high in the window; "recent sweep" could be 400 bars old;
   supply/demand zones spanned the whole impulse candle; VWAP accumulated across the loaded window. All rebuilt.
9. **Analysis ran on the unclosed candle** and on stale/mid-switch data. Now closed candles only, validated, gated.
10. **Price alerts never fired** (`alertEngine.evaluate` was never called). Now fed from the live ticker.

## Security (NOT changed — needs your decision)
- Every Supabase table has `USING (true)` policies for `anon`: anyone with the public anon key can read/modify/delete all rows. Add auth + per-user RLS.
- `VITE_FINNHUB_API_KEY` is bundled into the browser and the `.env` was in the shipped zip: **rotate the key** and move provider calls behind a server proxy/edge function.
  (`.env` is now git-ignored; `.env.example` added.)

## Known limitations
- Twelve Data / Finnhub / calendar request formats were implemented from their public docs and are unverified against live endpoints here. The calendar JSON host may block browser CORS: set `VITE_CALENDAR_URL` to your own proxy.
- Finnhub's candle endpoint is plan-restricted; without Twelve Data the app shows "HISTORICAL DATA UNAVAILABLE" and builds candles from live ticks only (first partial bar excluded from analysis; analysis needs 50 bars).
- Spot FX/gold carry no real volume: VWAP, volume ratio and order flow show "—"/unavailable. Order flow is BTC only (Binance aggTrade) and is labelled PARTIAL when accumulation started mid-candle.
- Alerts evaluate only for the asset currently open (no hidden background polling).
- Evidence thresholds (e.g. net ≥4.5 points, R:R ≥1.5, stop 1–4 ATR) are reasoned defaults, not backtested. No win-rate or accuracy is claimed.
