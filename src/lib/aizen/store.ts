import type { AizenState } from './types';
import { createInitialState } from './paperEngine';
import { sanitizeExecution, sanitizeRisk } from './risk';

// ── Persistence (paper account) ─────────────────────────────────
// localStorage in the browser, a JSON file in the worker. Paper and (future) live data use DIFFERENT keys
// so they can never be mixed.

export const PAPER_STORAGE_KEY = 'tradex:aizen:paper:v1';

export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

// ── Cross-tab agent lock (browser) ──────────────────────────────
// Only ONE tab may run the agent against the shared localStorage account. A tab owns the lock while it keeps
// refreshing it (every cycle); a lock older than the TTL (tab closed / crashed / frozen) can be taken over.
// Best effort: two tabs starting in the same millisecond can both win once, and the next cycle resolves it.
export const LOCK_KEY = 'tradex:aizen:agent-lock:v1';
export const LOCK_TTL_MS = 90_000;

export function claimLock(store: KeyValueStore, tabId: string, nowMs: number, ttlMs = LOCK_TTL_MS): boolean {
  try {
    const raw = store.getItem(LOCK_KEY);
    const held = raw ? (JSON.parse(raw) as { id?: string; t?: number }) : null;
    if (held && held.id !== tabId && typeof held.t === 'number' && nowMs - held.t < ttlMs) return false;
    store.setItem(LOCK_KEY, JSON.stringify({ id: tabId, t: nowMs }));
    const check = JSON.parse(store.getItem(LOCK_KEY) ?? 'null') as { id?: string } | null;
    return check?.id === tabId;
  } catch { return true; }   // storage unavailable ⇒ nothing is shared between tabs anyway
}

export function releaseLock(store: KeyValueStore, tabId: string): void {
  try {
    const held = JSON.parse(store.getItem(LOCK_KEY) ?? 'null') as { id?: string } | null;
    if (held?.id === tabId) store.setItem(LOCK_KEY, JSON.stringify({ id: tabId, t: 0 }));
  } catch { /* ignore */ }
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Rebuild a state from untrusted JSON. Never throws; anything unusable falls back to a fresh paper account. */
export function hydrateState(raw: unknown): AizenState {
  const base = createInitialState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AizenState>;
  if (r.version !== 1 || r.accountType !== 'paper') return base;
  const settings = { ...base.settings, ...(r.settings ?? {}) };
  settings.risk = sanitizeRisk(r.settings?.risk);
  settings.execution = sanitizeExecution(r.settings?.execution);
  settings.markets = { ...base.settings.markets, ...(r.settings?.markets ?? {}) };
  settings.mode = settings.mode === 'approval' ? 'approval' : 'paper';          // 'live' can never be restored
  const start = Number.isFinite(r.account?.startingEquity) ? r.account!.startingEquity : base.account.startingEquity;
  const balance = Number.isFinite(r.account?.balance) ? r.account!.balance : start;
  return {
    ...base, settings,
    account: { startingEquity: start, balance, peakEquity: Number.isFinite(r.account?.peakEquity) ? Math.max(r.account!.peakEquity, balance) : Math.max(start, balance) },
    positions: arr(r.positions), pending: arr(r.pending),
    trades: arr<AizenState['trades'][number]>(r.trades).filter(t => t && t.accountType === 'paper'),
    decisions: arr(r.decisions), riskEvents: arr(r.riskEvents), executionLog: arr(r.executionLog),
    seenOrderKeys: arr(r.seenOrderKeys),
    lastAnalyzedBar: r.lastAnalyzedBar && typeof r.lastAnalyzedBar === 'object' ? r.lastAnalyzedBar : {},
    heartbeat: { lastCycleAt: r.heartbeat?.lastCycleAt ?? null, lastError: r.heartbeat?.lastError ?? null, cycles: r.heartbeat?.cycles ?? 0 },
  };
}

export function loadState(store: KeyValueStore): AizenState {
  try {
    const raw = store.getItem(PAPER_STORAGE_KEY);
    return raw ? hydrateState(JSON.parse(raw)) : createInitialState();
  } catch { return createInitialState(); }
}

export function saveState(store: KeyValueStore, s: AizenState): boolean {
  try { store.setItem(PAPER_STORAGE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

/** Wipes the paper account (history included) but keeps the user's settings. */
export function resetPaperAccount(s: AizenState): AizenState {
  const fresh = createInitialState(s.settings);
  fresh.settings.agentOn = false;
  return fresh;
}
