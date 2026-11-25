import { useEffect, useState } from 'react';
import { fetchCalendar } from '@/lib/news/calendar';
import type { CalendarEvent } from '@/lib/news/risk';

export interface CalendarState {
  /** null = source unavailable (NOT "no events"). */
  events: CalendarEvent[] | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const POLL_MS = 15 * 60_000;

/** Polls the economic calendar; aborts in-flight requests and clears its timer on unmount. */
export function useEconomicCalendar(enabled = true): CalendarState {
  const [state, setState] = useState<CalendarState>({ events: null, loading: enabled, error: null, lastUpdated: null });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let ctl = new AbortController();

    const load = async () => {
      ctl.abort();
      ctl = new AbortController();
      try {
        const events = await fetchCalendar(ctl.signal);
        if (alive) setState({ events, loading: false, error: null, lastUpdated: Date.now() });
      } catch (e) {
        if (!alive || (e as Error)?.name === 'AbortError') return;
        // keep previously fetched events (still valid) but record the error
        setState(prev => ({ ...prev, loading: false, error: (e as Error).message }));
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); ctl.abort(); };
  }, [enabled]);

  return state;
}
