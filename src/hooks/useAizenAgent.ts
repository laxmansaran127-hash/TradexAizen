import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, Timeframe } from '@/types/trading';
import type { CalendarEvent } from '@/lib/news/risk';
import { useEconomicCalendar } from '@/hooks/useEconomicCalendar';
import type { AizenSettings, AizenState, MarketCategory, PriceMap, RiskSettings } from '@/lib/aizen/types';
import { LIVE_TRADING_AVAILABLE } from '@/lib/aizen/types';
import { runCycle, latestPrice } from '@/lib/aizen/agent';
import { createLiveDeps } from '@/lib/aizen/feeds';
import {
  approvePending, clearEmergencyStop, closePositionAtMarket, declinePending, emergencyStop,
} from '@/lib/aizen/paperEngine';
import { sanitizeRisk } from '@/lib/aizen/risk';
import { PAPER_STORAGE_KEY, claimLock, loadState, releaseLock, resetPaperAccount, saveState } from '@/lib/aizen/store';
import { riskStatus } from '@/lib/aizen/status';

// ── Browser host for the Aizen paper-trading agent ──────────────
// All decisions come from the pure core in src/lib/aizen. This hook only schedules cycles, persists the state
// and routes user actions. It runs while the app is open; scripts/aizen-worker.ts runs the same cycle headless.
// Every state change is applied to a CLONE which is committed whole, and user actions wait for a running cycle
// (except Emergency STOP, which aborts it), so a cycle can never overwrite what the user just did.

const CYCLE_MS = 30_000;
const PRICE_MAX_AGE_MS = 3 * 60_000;

export function useAizenAgent() {
  const [state, setState] = useState<AizenState>(() => loadState(window.localStorage));
  const [prices, setPrices] = useState<PriceMap>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [tabId] = useState(() => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  /** false ⇒ another tab/window owns the agent; this one only mirrors the shared state. */
  const [ownerTab, setOwnerTab] = useState(true);
  const discardRef = useRef(false);
  const calRef = useRef<CalendarEvent[] | null>(null);
  const deps = useMemo(() => createLiveDeps(() => calRef.current), []);

  const ref = useRef(state);
  const pricesRef = useRef<{ at: number; map: PriceMap }>({ at: 0, map: {} });
  const inflight = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: AizenState) => {
    ref.current = next;
    setState(next);
    if (!saveState(window.localStorage, next)) setNotice('Could not save to browser storage (full or blocked) — history may be lost on reload.');
  }, []);

  const mutate = useCallback((fn: (s: AizenState) => void) => {
    const next = structuredClone(ref.current);
    fn(next);
    commit(next);
  }, [commit]);

  // Serialise user actions behind a running cycle so neither overwrites the other.
  const afterCycle = useCallback(async (fn: () => void | Promise<void>) => {
    try { await inflight.current; } catch { /* cycle errors are handled inside */ }
    await fn();
  }, []);

  const cycle = useCallback(async () => {
    if (inflight.current) return;
    const s0 = ref.current;
    if (!s0.settings.agentOn && s0.positions.length === 0 && s0.pending.length === 0) return;
    if (!claimLock(window.localStorage, tabId, Date.now())) { setOwnerTab(false); return; }
    setOwnerTab(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    discardRef.current = false;
    setBusy(true);
    const p = (async () => {
      const work = structuredClone(ref.current);
      try {
        const r = await runCycle(work, deps, Date.now(), ctl.signal);
        pricesRef.current = { at: Date.now(), map: { ...pricesRef.current.map, ...r.prices } };
        setPrices(pricesRef.current.map);
      } catch (e) {
        work.heartbeat = { ...work.heartbeat, lastError: (e as Error).message };
      }
      // Another tab changed the shared account while this cycle was running: drop this cycle's result (it was
      // computed from older state) instead of overwriting the newer data. The next cycle starts from the new state.
      if (discardRef.current) { discardRef.current = false; return; }
      commit(work);
    })();
    inflight.current = p;
    try { await p; } finally { inflight.current = null; abortRef.current = null; setBusy(false); }
  }, [commit, deps, tabId]);

  // Scheduler: runs while the agent is ON or positions / approvals are open (positions must always be managed).
  const active = state.settings.agentOn || state.positions.length > 0 || state.pending.length > 0;
  // The economic calendar is only polled while Aizen is active. null = UNAVAILABLE (never treated as "no events").
  const calendar = useEconomicCalendar(active);
  calRef.current = calendar.events;
  useEffect(() => {
    if (!active) return;
    void cycle();
    const id = window.setInterval(() => { void cycle(); }, CYCLE_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void cycle(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, cycle]);

  // Shared account: adopt changes written by another tab (the 'storage' event never fires in the tab that wrote).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PAPER_STORAGE_KEY || e.newValue === null) return;
      discardRef.current = true;
      abortRef.current?.abort();
      const next = loadState(window.localStorage);
      ref.current = next;
      setState(next);
    };
    const onHide = () => releaseLock(window.localStorage, tabId);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('pagehide', onHide); };
  }, [tabId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const knownPrices = useCallback((): PriceMap => (Date.now() - pricesRef.current.at < PRICE_MAX_AGE_MS ? pricesRef.current.map : {}), []);

  // ── actions ──
  const setAgentOn = useCallback((on: boolean) => {
    mutate(s => {
      if (on && s.settings.emergencyStopped) { setNotice('Clear the Emergency STOP before turning the agent on.'); return; }
      s.settings.agentOn = on;
    });
    if (on) void afterCycle(cycle);
  }, [mutate, afterCycle, cycle]);

  const setMode = useCallback((mode: AizenSettings['mode']) => {
    if (mode === 'live' && !LIVE_TRADING_AVAILABLE) { setNotice('Live trading is locked: no broker/exchange execution connector is installed or authorised.'); return; }
    mutate(s => { s.settings.mode = mode; });
  }, [mutate]);

  const toggleMarket = useCallback((c: MarketCategory) => mutate(s => { s.settings.markets[c] = !s.settings.markets[c]; }), [mutate]);
  const toggleAsset = useCallback((a: Asset) => mutate(s => { s.settings.assets = s.settings.assets.includes(a) ? s.settings.assets.filter(x => x !== a) : [...s.settings.assets, a]; }), [mutate]);
  const setTimeframe = useCallback((tf: Timeframe) => mutate(s => { s.settings.timeframe = tf; }), [mutate]);
  const setPolicy = useCallback((p: AizenSettings['emergencyPolicy']) => mutate(s => { s.settings.emergencyPolicy = p; }), [mutate]);
  const updateRisk = useCallback((patch: Partial<RiskSettings>) => mutate(s => {
    s.settings.risk = sanitizeRisk({ ...s.settings.risk, ...patch });
    if (patch.startingEquity !== undefined && s.trades.length === 0 && s.positions.length === 0) {
      s.account = { startingEquity: s.settings.risk.startingEquity, balance: s.settings.risk.startingEquity, peakEquity: s.settings.risk.startingEquity };
    }
  }), [mutate]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();                                  // nothing new can start from the running cycle
    await afterCycle(() => mutate(s => emergencyStop(s, knownPrices(), Math.floor(Date.now() / 1000))));
    setNotice('Emergency STOP active — no new orders will be created.');
  }, [afterCycle, mutate, knownPrices]);

  const clearStop = useCallback(() => mutate(s => clearEmergencyStop(s, Math.floor(Date.now() / 1000))), [mutate]);

  const approve = useCallback(async (id: string) => {
    await afterCycle(async () => {
      const p = ref.current.pending.find(x => x.id === id);
      if (!p) return;
      const px = await latestPrice(deps, p.decision.assetId, p.decision.timeframe, Date.now());
      if (!px) { setNotice(`Cannot approve ${p.decision.symbol}: no current market data.`); return; }
      let res: { ok: boolean; reason?: string } = { ok: false };
      const nowSec = Math.floor(Date.now() / 1000);
      mutate(s => { res = approvePending(s, id, { nowSec, prices: { ...knownPrices(), [p.decision.assetId]: px.price }, livePrice: px.price, spreadBps: null, feed: px.feed }); });
      setNotice(res.ok ? `${p.decision.symbol} approved — simulated paper order filled.` : `Approval rejected by the risk layer: ${res.reason ?? 'unknown reason'}`);
    });
  }, [afterCycle, deps, mutate, knownPrices]);

  const decline = useCallback((id: string) => mutate(s => declinePending(s, id, Math.floor(Date.now() / 1000))), [mutate]);

  const closePosition = useCallback(async (id: string) => {
    await afterCycle(async () => {
      const pos = ref.current.positions.find(p => p.id === id);
      if (!pos) return;
      const px = await latestPrice(deps, pos.assetId, pos.timeframe, Date.now());
      if (!px) { setNotice(`Cannot close ${pos.symbol}: no current market data (the stop and targets still protect it).`); return; }
      mutate(s => { closePositionAtMarket(s, id, px.price, 'manual', Math.floor(Date.now() / 1000)); });
    });
  }, [afterCycle, deps, mutate]);

  const reset = useCallback(() => commit(resetPaperAccount(ref.current)), [commit]);

  const status = useMemo(() => riskStatus(state, prices, now), [state, prices, now]);

  return {
    state, prices, busy, notice, now, status, ownerTab, dismissNotice: () => setNotice(null),
    setAgentOn, setMode, toggleMarket, toggleAsset, setTimeframe, setPolicy, updateRisk,
    stop, clearStop, approve, decline, closePosition, reset, runNow: () => afterCycle(cycle),
  };
}

export type AizenAgent = ReturnType<typeof useAizenAgent>;
