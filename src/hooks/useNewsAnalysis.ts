import { useState, useEffect, useRef, useCallback } from 'react';
import type { NewsItem, NewsState, InstrumentMode } from '@/types/news';
import {
  normalizeFinnhubNews,
  normalizeCryptoPanicNews,
  normalizeNewsApiNews,
  filterNewsByInstrument,
  enrichWithContext,
  getPollIntervalMs,
} from '@/utils/newsUtils';

interface UseNewsAnalysisArgs {
  mode: InstrumentMode;
  displaySymbol: string;
  assetId: string;
  /** When false the hook is inert (lets a parent own the single news subscription). */
  enabled?: boolean;
}

const INITIAL_STATE: NewsState = {
  items: [],
  loading: false,
  error: null,
  lastUpdated: null,
  sourceUsed: null,
};

// ── Fetch with timeout ───────────────────────────────────────────

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ── Source fetchers with fallback logic ──────────────────────────

async function fetchFinnhubNews(mode: InstrumentMode): Promise<NewsItem[]> {
  const apiKey = import.meta.env.VITE_FINNHUB_API_KEY ?? '';
  if (!apiKey) throw new Error('No Finnhub API key');

  const category = mode === 'crypto' ? 'crypto' : 'general';
  const url = `https://finnhub.io/api/v1/news?category=${category}&token=${apiKey}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const data = await res.json();
  const items = normalizeFinnhubNews(data);
  if (items.length === 0) throw new Error('Finnhub returned no items');
  return items;
}

async function fetchCryptoPanicNews(): Promise<NewsItem[]> {
  // No auth token available in env — attempt public endpoint
  const url = 'https://cryptopanic.com/api/v1/posts/?auth_token=free&kind=news';
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`CryptoPanic ${res.status}`);
  const data = await res.json();
  const items = normalizeCryptoPanicNews(data);
  if (items.length === 0) throw new Error('CryptoPanic returned no items');
  return items;
}

async function fetchNewsApiNews(displaySymbol: string): Promise<NewsItem[]> {
  // No NewsAPI key in env — this is the last fallback
  const apiKey = import.meta.env.VITE_NEWS_API_KEY ?? '';
  if (!apiKey) throw new Error('No NewsAPI key');

  const query = encodeURIComponent(displaySymbol.replace('/', ' '));
  const url = `https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&pageSize=30&apiKey=${apiKey}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
  const data = await res.json();
  const items = normalizeNewsApiNews(data);
  if (items.length === 0) throw new Error('NewsAPI returned no items');
  return items;
}

// ── Main hook ────────────────────────────────────────────────────

export function useNewsAnalysis({ mode, displaySymbol, assetId, enabled = true }: UseNewsAnalysisArgs): NewsState {
  const [state, setState] = useState<NewsState>(INITIAL_STATE);
  const mountedRef = useRef(true);
  const fetchRef = useRef<(() => void) | null>(null);

  const doFetch = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    let rawItems: NewsItem[] | null = null;
    let sourceUsed: string | null = null;
    let lastError = '';

    // Source 1: Finnhub
    try {
      rawItems = await fetchFinnhubNews(mode);
      sourceUsed = 'Finnhub';
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }

    // Source 2: CryptoPanic (crypto only)
    if (!rawItems && mode === 'crypto') {
      try {
        rawItems = await fetchCryptoPanicNews();
        sourceUsed = 'CryptoPanic';
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    // Source 3: NewsAPI
    if (!rawItems) {
      try {
        rawItems = await fetchNewsApiNews(displaySymbol);
        sourceUsed = 'NewsAPI';
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    if (!mountedRef.current) return;

    if (rawItems && rawItems.length > 0) {
      const enriched = enrichWithContext(rawItems, mode, displaySymbol, assetId);
      const filtered = filterNewsByInstrument(enriched, mode, displaySymbol, assetId);
      setState({
        items: filtered,
        loading: false,
        error: null,
        lastUpdated: Date.now(),
        sourceUsed,
      });
    } else {
      setState({
        items: [],
        loading: false,
        error: `News unavailable at this time. Retrying...`,
        lastUpdated: Date.now(),
        sourceUsed: null,
      });
    }
  }, [mode, displaySymbol, assetId]);

  // Store latest fetch in ref for interval reuse
  fetchRef.current = doFetch;

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return () => { mountedRef.current = false; };

    // Initial fetch
    doFetch();

    // Set up polling with dynamic interval
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const setupInterval = () => {
      if (intervalId) clearInterval(intervalId);
      const ms = getPollIntervalMs(mode);
      intervalId = setInterval(() => {
        if (mountedRef.current && fetchRef.current) {
          fetchRef.current();
        }
      }, ms);
    };

    setupInterval();

    // Re-evaluate interval every 5 minutes (in case session boundary crossed)
    const reevalId = setInterval(setupInterval, 5 * 60 * 1000);

    return () => {
      mountedRef.current = false;
      if (intervalId) clearInterval(intervalId);
      clearInterval(reevalId);
    };
  }, [doFetch, mode, enabled]);

  return state;
}
