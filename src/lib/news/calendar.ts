import { fetchJson } from '@/lib/data/http';
import type { CalendarEvent } from './risk';

// ── Economic calendar provider ──────────────────────────────────
// Default: the public weekly calendar JSON used by many trading tools. Override
// with VITE_CALENDAR_URL to point at your own proxy (recommended for production
// — this endpoint may rate-limit or block cross-origin browser requests).
// Failure ⇒ throws; callers must treat that as "calendar unavailable", never as "no events".

const DEFAULT_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

export function calendarUrl(): string {
  return (import.meta.env?.VITE_CALENDAR_URL as string | undefined) || DEFAULT_URL;
}

export function parseCalendar(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) throw new Error('Unexpected calendar response');
  const out: CalendarEvent[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const time = Date.parse(String(r.date ?? ''));
    const currency = String(r.country ?? r.currency ?? '').toUpperCase();
    const impactRaw = String(r.impact ?? '').toLowerCase();
    if (!Number.isFinite(time) || !currency) continue;
    const impact = impactRaw === 'high' ? 'HIGH' : impactRaw === 'medium' ? 'MEDIUM' : impactRaw === 'low' ? 'LOW' : null;
    if (!impact) continue; // "Holiday" and unknown classes are not tradeable releases
    out.push({
      id: `${currency}-${time}-${String(r.title ?? '')}`,
      title: String(r.title ?? 'Economic event'),
      currency, time, impact,
      forecast: r.forecast ? String(r.forecast) : undefined,
      previous: r.previous ? String(r.previous) : undefined,
      actual: r.actual ? String(r.actual) : undefined,
      source: 'Economic calendar',
    });
  }
  return out;
}

export async function fetchCalendar(signal?: AbortSignal): Promise<CalendarEvent[]> {
  return parseCalendar(await fetchJson(calendarUrl(), { signal, timeoutMs: 8000, retries: 1 }));
}
