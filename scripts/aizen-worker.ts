/**
 * Aizen PAPER-trading worker — runs the same cycle as the browser, headless, so paper trading does not
 * depend on a browser tab staying open. It places NO real orders and holds NO secrets beyond the optional
 * market-data keys (read from the environment, never shipped to a browser).
 *
 *   npx tsx --tsconfig tests/tsconfig.json scripts/aizen-worker.ts
 *
 * Environment (all optional):
 *   AIZEN_STATE_FILE     JSON state file (default ./aizen-paper-state.json). Created on first run.
 *   AIZEN_INTERVAL_SEC   seconds between cycles (default 60, minimum 15)
 *   AIZEN_AGENT_ON=1     switch the agent ON (otherwise open positions are managed but no new trades are opened)
 *   AIZEN_ASSETS=BTC,ETH asset ids to trade;  AIZEN_TIMEFRAME=1H
 *   VITE_FINNHUB_API_KEY / VITE_TWELVEDATA_API_KEY   needed only for forex & gold history
 *
 * Kill switch: create the file  <state file>.STOP  (e.g. `touch aizen-paper-state.json.STOP`) and the worker
 * triggers the Emergency STOP on its next cycle (applying the policy stored in the state), then removes the file.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { AizenState } from '../src/lib/aizen/types';
import { createInitialState, emergencyStop } from '../src/lib/aizen/paperEngine';
import { hydrateState } from '../src/lib/aizen/store';
import { runCycle } from '../src/lib/aizen/agent';
import { createLiveDeps } from '../src/lib/aizen/feeds';
import { fetchCalendar } from '../src/lib/news/calendar';
import type { CalendarEvent } from '../src/lib/news/risk';
import type { Asset, Timeframe } from '../src/types/trading';

export function saveStateFile(path: string, s: AizenState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, path);                       // atomic on the same filesystem: a crash never leaves half a file
}

export function loadStateFile(path: string): AizenState {
  if (!existsSync(path)) return createInitialState();
  const raw = readFileSync(path, 'utf8');
  try { return hydrateState(JSON.parse(raw)); }
  catch { copyFileSync(path, `${path}.corrupt`); return createInitialState(); }   // keep the broken file for inspection
}

const pidAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === 'EPERM'; }
};

/** One worker per state file. A lock left by a dead process is taken over; a live one is respected. */
export function acquireWorkerLock(stateFile: string, pid: number = process.pid, isAlive: (p: number) => boolean = pidAlive): boolean {
  const lock = `${stateFile}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(lock, String(pid), { flag: 'wx' }); return true; }
    catch {
      const other = Number(readFileSync(lock, 'utf8'));
      if (other && other !== pid && isAlive(other)) return false;
      try { unlinkSync(lock); } catch { /* raced with another process — retry */ }
    }
  }
  return false;
}

export function releaseWorkerLock(stateFile: string, pid: number = process.pid): void {
  const lock = `${stateFile}.lock`;
  try { if (Number(readFileSync(lock, 'utf8')) === pid) unlinkSync(lock); } catch { /* already gone */ }
}

async function main(): Promise<void> {
  const file = process.env.AIZEN_STATE_FILE || './aizen-paper-state.json';
  const every = Math.max(15, Number(process.env.AIZEN_INTERVAL_SEC) || 60) * 1000;
  if (!acquireWorkerLock(file)) { console.error(`[aizen-worker] another worker already owns ${file} (lock ${file}.lock) — exiting`); process.exit(1); }
  let state = loadStateFile(file);
  if (process.env.AIZEN_ASSETS) state.settings.assets = process.env.AIZEN_ASSETS.split(',').map(s => s.trim()) as Asset[];
  if (process.env.AIZEN_TIMEFRAME) state.settings.timeframe = process.env.AIZEN_TIMEFRAME as Timeframe;
  if (process.env.AIZEN_AGENT_ON === '1' && !state.settings.emergencyStopped) state.settings.agentOn = true;

  let calendar: CalendarEvent[] | null = null;
  let calendarAt = 0;
  const deps = createLiveDeps(() => calendar);
  const ctl = new AbortController();
  let stopping = false;
  const shutdown = () => { stopping = true; ctl.abort(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

  console.log(`[aizen-worker] PAPER mode only — state ${file}, every ${every / 1000}s, agent ${state.settings.agentOn ? 'ON' : 'OFF'}`);
  console.log('[aizen-worker] NOTE: this file is a separate paper account — it is NOT synchronised with the browser account.');
  while (!stopping) {
    const now = Date.now();
    try {
      if (now - calendarAt > 15 * 60_000) {                    // calendar: null means UNAVAILABLE (never "no events")
        calendarAt = now;
        try { calendar = await fetchCalendar(ctl.signal); } catch { /* keep the previous events if we had any */ }
      }
      if (existsSync(`${file}.STOP`)) { emergencyStop(state, {}, Math.floor(now / 1000)); try { unlinkSync(`${file}.STOP`); } catch { /* ignore */ } }
      const r = await runCycle(state, deps, now, ctl.signal);
      saveStateFile(file, state);
      console.log(`[aizen-worker] ${new Date(now).toISOString()} open=${state.positions.length} closed+${r.closed.length} analysed=[${r.analysed.join(', ')}] errors=${r.errors.length}`);
    } catch (e) {
      console.error('[aizen-worker] cycle failed (will retry):', (e as Error).message);
      state.heartbeat.lastError = (e as Error).message;
    }
    await new Promise(res => { const t = setTimeout(res, every); ctl.signal.addEventListener('abort', () => { clearTimeout(t); res(null); }, { once: true }); });
  }
  saveStateFile(file, state);
  releaseWorkerLock(file);
  console.log('[aizen-worker] stopped cleanly');
}

if (process.argv[1] && basename(process.argv[1]).startsWith('aizen-worker')) main();
