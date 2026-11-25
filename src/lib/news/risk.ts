import type { NewsItem } from '@/types/news';
import type { NewsRiskDetail, NewsRiskLevel } from '@/lib/analysis/types';

// ── News-risk assessment ────────────────────────────────────────
// News NEVER creates a BUY/SELL. It only (a) raises a HIGH-risk gate around
// major releases and (b) is reported transparently. If no news/calendar source
// responded the result is 'unknown' / "NEWS DATA UNAVAILABLE" — never 'low' by default.

export interface CalendarEvent {
  id: string;
  title: string;
  currency: string;
  /** Scheduled release time, epoch ms. */
  time: number;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  forecast?: string;
  previous?: string;
  actual?: string;
  source: string;
  url?: string;
}

const MIN = 60_000;

/** Currencies whose releases can move this instrument. */
export function relevantCurrencies(assetId: string): string[] {
  switch (assetId) {
    case 'EURUSD': return ['EUR', 'USD'];
    case 'GBPUSD': return ['GBP', 'USD'];
    case 'USDJPY': return ['USD', 'JPY'];
    case 'GOLD': return ['USD'];
    default: return ['USD']; // crypto: USD macro (CPI, NFP, FOMC) is the shared driver
  }
}

const rank: Record<NewsRiskLevel, number> = { unknown: -1, low: 0, medium: 1, high: 2 };
const maxLevel = (a: NewsRiskLevel, b: NewsRiskLevel): NewsRiskLevel => (rank[b] > rank[a] ? b : a);

export interface AssessInput {
  events: CalendarEvent[] | null;       // null ⇒ calendar source unavailable
  headlines: NewsItem[] | null;         // null ⇒ news source unavailable
  currencies: string[];
  now: number;
}

export function assessNewsRisk({ events, headlines, currencies, now }: AssessInput): NewsRiskDetail {
  const drivers: string[] = [];
  const haveCal = events !== null;
  const haveNews = headlines !== null;

  if (!haveCal && !haveNews) {
    return { level: 'unknown', phase: null, drivers: ['NEWS DATA UNAVAILABLE — no calendar or headline source responded'], coverage: 'none' };
  }

  let level: NewsRiskLevel = 'low';
  let phase: NewsRiskDetail['phase'] = null;
  let nextEvent: NewsRiskDetail['nextEvent'];

  const setPhase = (p: 'BEFORE' | 'DURING' | 'AFTER', lv: NewsRiskLevel) => {
    if (rank[lv] >= rank[level]) phase = p;
  };

  // ── scheduled releases ──
  for (const ev of events ?? []) {
    if (!currencies.includes(ev.currency)) continue;
    if (ev.impact === 'LOW') continue;
    const dt = ev.time - now; // >0 upcoming
    const label = `${ev.currency} ${ev.title}`;
    let lv: NewsRiskLevel = 'low';
    let ph: 'BEFORE' | 'DURING' | 'AFTER' | null = null;

    if (dt > 0 && dt <= 60 * MIN)            { lv = ev.impact === 'HIGH' ? 'high' : 'medium'; ph = 'BEFORE'; drivers.push(`${label} in ${Math.ceil(dt / MIN)} min`); }
    else if (dt > 60 * MIN && dt <= 240 * MIN && ev.impact === 'HIGH') { lv = 'medium'; ph = 'BEFORE'; drivers.push(`${label} in ${(dt / 60 / MIN).toFixed(1)} h`); }
    else if (dt <= 0 && dt > -30 * MIN)      { lv = ev.impact === 'HIGH' ? 'high' : 'medium'; ph = 'DURING'; drivers.push(`${label} released ${Math.floor(-dt / MIN)} min ago`); }
    else if (dt <= -30 * MIN && dt > -120 * MIN && ev.impact === 'HIGH') { lv = 'medium'; ph = 'AFTER'; drivers.push(`${label} released ${Math.floor(-dt / MIN)} min ago (post-release volatility)`); }

    if (ph) {
      if (rank[lv] > rank[level]) level = lv;
      setPhase(ph, lv);
    }
    if (dt > 0 && (!nextEvent || ev.time < nextEvent.time)) {
      nextEvent = { title: ev.title, currency: ev.currency, time: ev.time, impact: ev.impact };
    }
  }

  // ── headlines ──
  for (const h of headlines ?? []) {
    const age = now - h.publishedAt;
    if (age < 0 || age > 4 * 60 * MIN) continue;
    let lv: NewsRiskLevel = 'low';
    if (h.impact === 'HIGH') lv = age <= 30 * MIN ? 'high' : 'medium';
    else if (h.impact === 'MEDIUM' && age <= 60 * MIN) lv = 'medium';
    if (lv !== 'low') {
      level = maxLevel(level, lv);
      if (rank[lv] >= rank[level]) { phase = age <= 30 * MIN ? 'DURING' : 'AFTER'; }
      drivers.push(`${h.impact} impact headline (${Math.floor(age / MIN)} min ago, ${h.source}): ${h.headline.slice(0, 90)}`);
    }
  }

  const coverage: NewsRiskDetail['coverage'] =
    haveCal && haveNews ? 'calendar+headlines' : haveCal ? 'calendar' : 'headlines-only';
  if (!haveCal) drivers.push('Scheduled-release calendar unavailable — CPI/NFP/FOMC timing is NOT covered; check an economic calendar');
  if (!haveNews) drivers.push('Headline feed unavailable');
  if (drivers.length === 0) drivers.push('No relevant high/medium-impact release or headline in the risk window');

  return { level, phase: level === 'low' ? null : phase, drivers: drivers.slice(0, 6), coverage, nextEvent };
}
