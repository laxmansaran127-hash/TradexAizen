import { useState, useEffect, useRef, useCallback } from 'react';

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: number;
  author: string;
  description: string;
  categories: string[];
  relatedAssets: string[];
  category: string;
  importance: 'high' | 'medium' | 'low';
}

interface Rss2JsonResponse {
  status: string;
  feed?: { title: string; url: string };
  items?: {
    title: string;
    link: string;
    pubDate: string;
    guid: string;
    author: string;
    description: string;
    categories: string[];
    thumbnail: string;
  }[];
}

interface FeedConfig {
  url: string;
  source: string;
  category: string;
}

const FEEDS: FeedConfig[] = [
  {
    url: 'https://cointelegraph.com/rss',
    source: 'Cointelegraph',
    category: 'Crypto',
  },
  {
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    source: 'CoinDesk',
    category: 'Crypto',
  },
  {
    url: 'https://www.fxstreet.com/rss/news',
    source: 'FXStreet',
    category: 'Forex',
  },
  {
    url: 'https://www.forexlive.com/feed',
    source: 'Forexlive',
    category: 'Forex',
  },
  {
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=EURUSD%3DX',
    source: 'Yahoo Finance',
    category: 'EUR',
  },
  {
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=GBPUSD%3DX',
    source: 'Yahoo Finance',
    category: 'GBP',
  },
  {
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=JPYUSD%3DX',
    source: 'Yahoo Finance',
    category: 'JPY',
  },
  {
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC%3DF',
    source: 'Yahoo Finance',
    category: 'Gold',
  },
  {
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD',
    source: 'Yahoo Finance',
    category: 'Crypto',
  },
];

const RSS2JSON = 'https://api.rss2json.com/v1/api.json';

const HIGH_IMPACT_KEYWORDS = [
  'breaking', 'alert', 'crash', 'surge', 'plunge', 'rate decision', 'fed ', 'ecb', 'boe', 'boj',
  'nonfarm', 'non-farm', 'nfp', 'cpi', 'gdp', 'fomc', 'interest rate', 'hike', 'cut', 'emergency',
  'ban', 'approval', 'sec ', 'lawsuit', 'hack', 'exploit', 'crash', 'bubble', 'collapse',
];

const MEDIUM_IMPACT_KEYWORDS = [
  'forecast', 'prediction', 'analysis', 'report', 'data', 'inflation', 'employment',
  'manufacturing', 'pmi', 'retail', 'trade', 'deficit', 'surplus', 'treasury', 'yield',
  'dollar', 'euro', 'pound', 'yen', 'gold', 'bitcoin', 'crypto', 'ethereum',
];

const ASSET_KEYWORDS: Record<string, string[]> = {
  BTC: ['bitcoin', 'btc', 'crypto', 'cryptocurrency', 'ethereum', 'blockchain', 'mining', 'halving'],
  EURUSD: ['eur', 'euro', 'ecb', 'european central', 'eurozone', 'euro zone', 'germany', 'france'],
  GBPUSD: ['gbp', 'pound', 'sterling', 'boe', 'bank of england', 'uk ', 'britain', 'british'],
  USDJPY: ['jpy', 'yen', 'boj', 'bank of japan', 'japan', 'tokyo'],
  GOLD: ['gold', 'xau', 'precious metal', 'bullion', 'safe haven'],
  USD: ['dollar', 'usd', 'fed', 'fomc', 'treasury', 'us ', 'nonfarm', 'non-farm', 'cpi', 'jobs', 'employment'],
  EUR: ['eur', 'euro', 'ecb', 'european'],
  GBP: ['gbp', 'pound', 'sterling', 'boe'],
  JPY: ['jpy', 'yen', 'boj', 'japan'],
};

function determineImportance(title: string, description: string): 'high' | 'medium' | 'low' {
  const text = `${title} ${description}`.toLowerCase();
  if (HIGH_IMPACT_KEYWORDS.some(kw => text.includes(kw))) return 'high';
  if (MEDIUM_IMPACT_KEYWORDS.some(kw => text.includes(kw))) return 'medium';
  return 'low';
}

function determineRelatedAssets(title: string, description: string, feedCategory: string): string[] {
  const text = `${title} ${description}`.toLowerCase();
  const related: string[] = [];

  for (const [asset, keywords] of Object.entries(ASSET_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      related.push(asset);
    }
  }

  if (feedCategory === 'Crypto' && !related.includes('BTC')) related.push('BTC');
  if (feedCategory === 'Gold' && !related.includes('GOLD')) related.push('GOLD');
  if (feedCategory === 'EUR' && !related.includes('EUR')) related.push('EUR');
  if (feedCategory === 'GBP' && !related.includes('GBP')) related.push('GBP');
  if (feedCategory === 'JPY' && !related.includes('JPY')) related.push('JPY');

  return [...new Set(related)];
}

function parseDate(dateStr: string): number {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  return Math.floor(Date.now() / 1000);
}

async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  try {
    const res = await fetch(`${RSS2JSON}?rss_url=${encodeURIComponent(feed.url)}`);
    if (!res.ok) return [];
    const data: Rss2JsonResponse = await res.json();
    if (data.status !== 'ok' || !data.items) return [];

    return data.items.map((item) => {
      const title = item.title || '';
      const desc = item.description || '';
      return {
        id: item.guid || item.link || title,
        title,
        link: item.link || '',
        source: feed.source,
        publishedAt: parseDate(item.pubDate),
        author: item.author || feed.source,
        description: desc.replace(/<[^>]*>/g, '').substring(0, 300),
        categories: item.categories || [],
        relatedAssets: determineRelatedAssets(title, desc, feed.category),
        category: feed.category === 'Crypto' ? 'Crypto'
          : feed.category === 'Forex' ? 'Forex'
          : feed.category === 'Gold' ? 'Gold'
          : feed.category,
        importance: determineImportance(title, desc),
      };
    });
  } catch {
    return [];
  }
}

export function useMarketNews(selectedAsset: string) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadNews = useCallback(async () => {
    try {
      const results = await Promise.allSettled(FEEDS.map(f => fetchFeed(f)));
      const allNews: NewsItem[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allNews.push(...result.value);
        }
      }

      if (allNews.length === 0) {
        setError('News temporarily unavailable');
        setLoading(false);
        return;
      }

      // Deduplicate by title similarity
      const seen = new Set<string>();
      const deduped = allNews.filter(item => {
        const key = item.title.toLowerCase().substring(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Sort by date descending
      deduped.sort((a, b) => b.publishedAt - a.publishedAt);

      setNews(deduped.slice(0, 80));
      setError(null);
      setLoading(false);
      setLastUpdate(Math.floor(Date.now() / 1000));
    } catch {
      setError('Failed to fetch news');
      setLoading(false);
    }
  }, []);

  // Initial load + auto refresh every 3 minutes
  useEffect(() => {
    loadNews();

    timerRef.current = setInterval(loadNews, 180000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loadNews]);

  // Filter and prioritize news based on selected asset
  const getFilteredNews = useCallback((filter: string): NewsItem[] => {
    if (filter === 'All') return news;
    if (filter === 'High Impact') return news.filter(n => n.importance === 'high');

    // For asset-specific filters, show related news first
    const assetKey = filter.toUpperCase();
    const related = news.filter(n =>
      n.relatedAssets.some(a => a === assetKey) ||
      n.category.toLowerCase() === filter.toLowerCase()
    );

    // If we have related news, show it; otherwise fall back to all
    return related.length > 0 ? related : [];
  }, [news]);

  // Get asset-prioritized news
  const getAssetNews = useCallback((count: number = 20): NewsItem[] => {
    if (selectedAsset === 'All') {
      return news.slice(0, count);
    }

    const assetKey = selectedAsset.replace('USD', '').replace('BTC', 'BTC').replace('GOLD', 'GOLD');
    const prioritized = news.filter(n =>
      n.relatedAssets.includes(selectedAsset) ||
      n.relatedAssets.includes(assetKey)
    );

    const rest = news.filter(n =>
      !n.relatedAssets.includes(selectedAsset) &&
      !n.relatedAssets.includes(assetKey)
    );

    return [...prioritized, ...rest].slice(0, count);
  }, [news, selectedAsset]);

  return { news, loading, error, lastUpdate, getFilteredNews, getAssetNews, refresh: loadNews };
}
