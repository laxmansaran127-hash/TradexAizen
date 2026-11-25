// ── News Analysis Types ─────────────────────────────────────────

export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type EventPhase = 'BEFORE' | 'DURING' | 'AFTER';
export type InstrumentMode = 'forex' | 'crypto';

export interface EconomicData {
  actual?: string;
  forecast?: string;
  previous?: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: number;
  eventTime?: number;
  impact: ImpactLevel;
  phase: EventPhase;
  economic: EconomicData;
  marketContext: string;
  keywords: string[];
  relatedSymbols: string[];
}

export interface NewsState {
  items: NewsItem[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  sourceUsed: string | null;
}
