import type { Candle } from '@/types/trading';
import type {
  ImpactLevel,
  EventPhase,
  InstrumentMode,
  NewsItem,
  EconomicData,
} from '@/types/news';

// ── Keyword sets for impact classification ──────────────────────

const HIGH_KEYWORDS = [
  'nfp', 'nonfarm', 'non-farm', 'cpi', 'interest rate', 'rate hike', 'rate cut',
  'fomc', 'ecb', 'fed chair', 'federal reserve', 'gdp', 'inflation',
  'sec ruling', 'sec sues', 'etf approval', 'bitcoin etf', 'ethereum etf',
  'exchange hack', 'regulatory ban', 'rate decision', 'powell', 'lagarde',
  'yellen', 'treasury', 'quantitative easing', 'qe', ' QT ',
  'emergency rate', 'surprise hike', 'surprise cut',
];

const MEDIUM_KEYWORDS = [
  'pmi', 'retail sales', 'trade balance', 'earnings', 'protocol upgrade',
  'partnership', 'hard fork', 'network upgrade', 'jobless claims',
  'consumer confidence', 'housing data', 'factory orders', 'durable goods',
  'current account', 'budget deficit', 'central bank', 'bpce',
  'boj', 'bank of japan', 'bank of england', 'boe',
];

// Keywords that indicate a scheduled/upcoming event (BEFORE phase)
const SCHEDULED_KEYWORDS = ['scheduled', 'upcoming', 'preview', 'ahead of', 'before', 'expected', 'forecast'];
// Keywords that indicate breaking/live news (DURING phase)
const BREAKING_KEYWORDS = ['breaking', 'just in', 'live', 'developing', 'urgent', 'alert'];
// Keywords that indicate post-release/reaction (AFTER phase)
const REACTION_KEYWORDS = ['after', 'post', 'reaction', 'following', 'in response to', 'subsequently'];

// ── Currency keyword maps for forex filtering ───────────────────

const CURRENCY_KEYWORDS: Record<string, string[]> = {
  USD: ['us dollar', 'usd', 'united states', 'american', 'federal reserve', 'fed', 'powell', 'yellen',
    'us treasury', 'us cpi', 'us gdp', 'us nfp', 'us pmi', 'us retail', 'us jobless', 'us inflation',
    'us rates', 'us economy', 'us trade', 'us budget', 'us consumer'],
  EUR: ['euro', 'eur', 'eurozone', 'eurozone', 'european central bank', 'ecb', 'lagarde',
    'european economy', 'eu cpi', 'eu gdp', 'eu pmi', 'eu inflation', 'eu rates',
    'eu trade', 'eu consumer', 'german', 'french', 'italian', 'spanish', 'dutch', 'irish'],
  GBP: ['british pound', 'gbp', 'pound sterling', 'sterling', 'uk ', 'united kingdom', 'britain',
    'bank of england', 'boe', 'bailey', 'uk cpi', 'uk gdp', 'uk pmi', 'uk inflation',
    'uk rates', 'uk economy', 'uk budget', 'uk retail', 'uk jobless'],
  JPY: ['japanese yen', 'jpy', 'yen', 'japan', 'japanese', 'bank of japan', 'boj',
    'ueda', 'japan cpi', 'japan gdp', 'japan pmi', 'japan inflation', 'japan rates',
    'japan economy', 'japan trade', 'japan budget'],
};

// ── Crypto keyword maps ─────────────────────────────────────────

const CRYPTO_NAMES: Record<string, string[]> = {
  BTC: ['bitcoin', 'btc', 'btcusdt', 'crypto market', 'cryptocurrency', 'digital asset'],
  ETH: ['ethereum', 'eth', 'ethusdt', 'vitalik', 'ether'],
  XRP: ['xrp', 'ripple', 'sec v ripple', 'rlp'],
  SOL: ['solana', 'sol', 'solusdt'],
  BCH: ['bitcoin cash', 'bch', 'bchusdt'],
  LTC: ['litecoin', 'ltc', 'ltcusdt'],
};

const MACRO_CRYPTO_KEYWORDS = [
  'crypto regulation', 'sec crypto', 'crypto etf', 'bitcoin etf', 'ethereum etf',
  'crypto ban', 'crypto adoption', 'institutional crypto', 'defi', 'blockchain',
  'stablecoin', 'cbdc', 'digital currency', 'web3', 'crypto exchange',
  'crypto market', 'digital asset', 'cryptocurrency',
];

// ── Determine instrument mode from asset config ─────────────────

export function deriveMode(category: string, displaySymbol: string): InstrumentMode {
  if (category === 'Crypto' || /USDT$/.test(displaySymbol)) return 'crypto';
  if (category === 'Forex') return 'forex';
  // Metals like gold — treat as forex-like (macro economic news matters)
  return 'forex';
}

// ── Extract currencies from forex pair ───────────────────────────

export function extractCurrencies(displaySymbol: string): string[] {
  const parts = displaySymbol.split('/');
  if (parts.length < 2) return [];
  return [parts[0].trim().toUpperCase(), parts[1].trim().toUpperCase()];
}

// ── Extract crypto coin symbol from pair ─────────────────────────

export function extractCryptoSymbol(assetId: string): string {
  return assetId.toUpperCase();
}

// ── Classify impact level from headline + summary ────────────────

export function classifyImpact(headline: string, summary?: string): ImpactLevel {
  const text = `${headline} ${summary ?? ''}`.toLowerCase();
  for (const kw of HIGH_KEYWORDS) {
    if (text.includes(kw)) return 'HIGH';
  }
  for (const kw of MEDIUM_KEYWORDS) {
    if (text.includes(kw)) return 'MEDIUM';
  }
  return 'LOW';
}

// ── Classify event phase ─────────────────────────────────────────

export function classifyPhase(headline: string, publishedAt: number, eventTime?: number): EventPhase {
  const text = headline.toLowerCase();

  // If we have a future event time, it's BEFORE
  if (eventTime && eventTime > publishedAt) return 'BEFORE';
  // If event time is in the past, it's AFTER
  if (eventTime && eventTime <= publishedAt) return 'AFTER';

  for (const kw of BREAKING_KEYWORDS) {
    if (text.includes(kw)) return 'DURING';
  }
  for (const kw of SCHEDULED_KEYWORDS) {
    if (text.includes(kw)) return 'BEFORE';
  }
  for (const kw of REACTION_KEYWORDS) {
    if (text.includes(kw)) return 'AFTER';
  }
  // Default: if published very recently (within 30 min), treat as DURING
  const ageMs = Date.now() - publishedAt;
  if (ageMs < 30 * 60 * 1000) return 'DURING';
  return 'AFTER';
}

// ── Generate plain-English market context ────────────────────────

export function generateMarketContext(
  headline: string,
  mode: InstrumentMode,
  currencies: string[],
  cryptoSymbol: string,
): string {
  const text = headline.toLowerCase();

  if (mode === 'forex') {
    if (currencies.length >= 2) {
      const [base, quote] = currencies;
      if (text.includes('rate hike') || text.includes('rate increase')) {
        return `Potential strengthening of the currency whose central bank is hiking rates. Watch for ${base}/${quote} volatility around the announcement.`;
      }
      if (text.includes('rate cut') || text.includes('rate decrease')) {
        return `Potential weakening of the currency whose central bank is cutting rates. Expect ${base}/${quote} movement as markets reprice rate expectations.`;
      }
      if (text.includes('cpi') || text.includes('inflation')) {
        return `Inflation data directly influences rate expectations for ${base} and ${quote}. Higher-than-expected inflation typically strengthens the currency via tighter policy expectations.`;
      }
      if (text.includes('nfp') || text.includes('nonfarm') || text.includes('jobless')) {
        return `Labor market data affects Fed policy expectations, impacting USD pairs. Strong data is hawkish for ${quote === 'USD' ? quote : base}.`;
      }
      if (text.includes('gdp')) {
        return `GDP growth data reflects economic health for the respective currency. Stronger growth supports currency appreciation for ${base} or ${quote}.`;
      }
      if (text.includes('ecb') || text.includes('european central bank')) {
        return `ECB policy decisions directly impact the Euro. Hawkish stance supports EUR; dovish stance pressures EUR.`;
      }
      if (text.includes('fed') || text.includes('federal reserve') || text.includes('fomc')) {
        return `Federal Reserve decisions impact the US Dollar broadly. Hawkish = USD strength; dovish = USD weakness. Affects ${base}/${quote} direction.`;
      }
      return `Relevant to ${base} or ${quote} — may influence ${base}/${quote} price action and short-term volatility.`;
    }
    return `Macroeconomic news relevant to the selected forex pair. May cause short-term volatility.`;
  }

  // Crypto mode
  if (text.includes('etf')) {
    return `ETF news drives institutional capital flows into ${cryptoSymbol}. Approvals are bullish; rejections or delays are bearish.`;
  }
  if (text.includes('regulation') || text.includes('sec') || text.includes('ban')) {
    return `Regulatory developments can significantly impact ${cryptoSymbol} price. Favorable regulation attracts capital; hostile regulation drives outflows.`;
  }
  if (text.includes('hack') || text.includes('exploit') || text.includes('breach')) {
    return `Security incidents erode market confidence and may cause broad crypto selling pressure, including ${cryptoSymbol}.`;
  }
  if (text.includes('adoption') || text.includes('partnership') || text.includes('integration')) {
    return `Adoption news signals growing utility for ${cryptoSymbol}. Positive for long-term sentiment and price.`;
  }
  if (text.includes('upgrade') || text.includes('fork') || text.includes('protocol')) {
    return `Network upgrades can improve ${cryptoSymbol}'s capabilities and value proposition. Monitor for execution risk.`;
  }
  return `Crypto market news that may influence ${cryptoSymbol} sentiment and price action.`;
}

// ── Extract keywords from headline ───────────────────────────────

export function extractKeywords(headline: string): string[] {
  const text = headline.toLowerCase();
  const keywords: string[] = [];
  const allKeywords = [...HIGH_KEYWORDS, ...MEDIUM_KEYWORDS];
  for (const kw of allKeywords) {
    if (text.includes(kw)) keywords.push(kw.trim());
  }
  return [...new Set(keywords)].slice(0, 5);
}

// ── Filter news by instrument type ───────────────────────────────

export function filterNewsByInstrument(
  items: NewsItem[],
  mode: InstrumentMode,
  displaySymbol: string,
  assetId: string,
): NewsItem[] {
  if (mode === 'forex') {
    const currencies = extractCurrencies(displaySymbol);
    const keywordSets = currencies
      .map(c => CURRENCY_KEYWORDS[c])
      .filter(Boolean) as string[][];
    if (keywordSets.length === 0) return items;

    const allKeywords = keywordSets.flat();
    return items.filter(item => {
      const text = `${item.headline} ${item.summary ?? ''} ${item.keywords.join(' ')}`.toLowerCase();
      return allKeywords.some(kw => text.includes(kw));
    });
  }

  // Crypto mode
  const cryptoKey = extractCryptoSymbol(assetId);
  const coinKeywords = CRYPTO_NAMES[cryptoKey] ?? [cryptoKey.toLowerCase()];
  return items.filter(item => {
    const text = `${item.headline} ${item.summary ?? ''}`.toLowerCase();
    const matchesCoin = coinKeywords.some(kw => text.includes(kw));
    const matchesMacro = MACRO_CRYPTO_KEYWORDS.some(kw => text.includes(kw));
    return matchesCoin || matchesMacro;
  });
}

// ── Normalize raw API responses into NewsItem[] ──────────────────

let idCounter = 0;
function nextId(): string {
  return `news-${++idCounter}-${Date.now()}`;
}

export function normalizeFinnhubNews(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map(item => {
    const headline = String(item.headline ?? '');
    const summary = item.summary ? String(item.summary) : undefined;
    const source = String(item.source ?? 'Finnhub');
    const url = String(item.url ?? '#');
    const publishedAt = (item.datetime as number)
      ? (item.datetime as number) * 1000
      : Date.now();
    const impact = classifyImpact(headline, summary);
    const phase = classifyPhase(headline, publishedAt);
    const related = String(item.related ?? '');
    return {
      id: nextId(),
      headline,
      summary,
      source,
      url,
      publishedAt,
      impact,
      phase,
      economic: extractEconomicData(headline, summary),
      marketContext: '',
      keywords: extractKeywords(headline),
      relatedSymbols: related ? related.split(',').map(s => s.trim()) : [],
    };
  });
}

export function normalizeCryptoPanicNews(raw: unknown): NewsItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const results = (raw as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return (results as Record<string, unknown>[]).map(item => {
    const headline = String(item.title ?? '');
    const source = String(item.source ?? 'CryptoPanic');
    const url = String(item.url ?? '#');
    const publishedAt = (item.published_at as string)
      ? new Date(item.published_at as string).getTime()
      : Date.now();
    const impact = classifyImpact(headline);
    const phase = classifyPhase(headline, publishedAt);
    return {
      id: nextId(),
      headline,
      summary: undefined,
      source,
      url,
      publishedAt,
      impact,
      phase,
      economic: extractEconomicData(headline),
      marketContext: '',
      keywords: extractKeywords(headline),
      relatedSymbols: [],
    };
  });
}

export function normalizeNewsApiNews(raw: unknown): NewsItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const articles = (raw as Record<string, unknown>).articles;
  if (!Array.isArray(articles)) return [];
  return (articles as Record<string, unknown>[]).map(item => {
    const headline = String(item.title ?? '');
    const summary = item.description ? String(item.description) : undefined;
    const source = item.source && typeof item.source === 'object'
      ? String((item.source as Record<string, unknown>).name ?? 'NewsAPI')
      : 'NewsAPI';
    const url = String(item.url ?? '#');
    const publishedAt = (item.publishedAt as string)
      ? new Date(item.publishedAt as string).getTime()
      : Date.now();
    const impact = classifyImpact(headline, summary);
    const phase = classifyPhase(headline, publishedAt);
    return {
      id: nextId(),
      headline,
      summary,
      source,
      url,
      publishedAt,
      impact,
      phase,
      economic: extractEconomicData(headline, summary),
      marketContext: '',
      keywords: extractKeywords(headline),
      relatedSymbols: [],
    };
  });
}

// ── Extract economic data from text (best-effort) ────────────────

function extractEconomicData(headline: string, summary?: string): EconomicData {
  const text = `${headline} ${summary ?? ''}`;
  const data: EconomicData = {};

  const actualMatch = text.match(/(?:actual|result)[:\s]+([0-9.,%]+)/i);
  if (actualMatch) data.actual = actualMatch[1];

  const forecastMatch = text.match(/(?:forecast|expected|estimate)[:\s]+([0-9.,%]+)/i);
  if (forecastMatch) data.forecast = forecastMatch[1];

  const previousMatch = text.match(/(?:previous|prior|last)[:\s]+([0-9.,%]+)/i);
  if (previousMatch) data.previous = previousMatch[1];

  return data;
}

// ── Determine polling interval based on mode and UTC hour ────────

export function getPollIntervalMs(mode: InstrumentMode): number {
  const now = new Date();
  const utcHour = now.getUTCHours();

  if (mode === 'crypto') {
    // Crypto is always active — poll every 1 minute
    return 60 * 1000;
  }

  // Forex: London/NY overlap = 12:00–16:00 UTC
  if (utcHour >= 12 && utcHour < 16) {
    return 60 * 1000; // 1 minute during overlap
  }

  // London session 08:00–12:00 UTC and NY session 13:00–17:00 UTC
  if ((utcHour >= 8 && utcHour < 12) || (utcHour >= 13 && utcHour < 17)) {
    return 2 * 60 * 1000; // 2 minutes during single session
  }

  return 5 * 60 * 1000; // 5 minutes off-peak
}

// ── Format timestamps ────────────────────────────────────────────

export function formatLocalTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(ts: number): string {
  const local = new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const utc = new Date(ts).toUTCString().match(/, \d+:\d+/)?.[0]?.replace(', ', '') ?? '';
  return `${local} (${utc} UTC)`;
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Apply market context to all items ────────────────────────────

export function enrichWithContext(
  items: NewsItem[],
  mode: InstrumentMode,
  displaySymbol: string,
  assetId: string,
): NewsItem[] {
  const currencies = mode === 'forex' ? extractCurrencies(displaySymbol) : [];
  const cryptoSymbol = mode === 'crypto' ? extractCryptoSymbol(assetId) : '';
  return items.map(item => ({
    ...item,
    marketContext: generateMarketContext(item.headline, mode, currencies, cryptoSymbol),
  }));
}

// Re-export Candle for type completeness
export type { Candle };
