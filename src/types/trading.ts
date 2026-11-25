// ── Core trading types ──────────────────────────────────────────

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TickerData {
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  changePercent: number;
  change: number;
  timestamp: number;
}

export type Asset = 'BTC' | 'GOLD' | 'EURUSD' | 'GBPUSD' | 'USDJPY' | 'ETH' | 'XRP' | 'SOL' | 'BCH' | 'LTC';

export type DataSource = 'binance' | 'finnhub';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D';

export type ConnectionState = 'live' | 'connecting' | 'reconnecting' | 'disconnected';

export interface AssetConfig {
  id: Asset;
  label: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  category: string;
  decimals: number;
  source: DataSource;
}

export const ASSET_CONFIGS: AssetConfig[] = [
  {
    id: 'BTC',
    label: 'Bitcoin',
    symbol: 'BTCUSDT',
    displaySymbol: 'BTC/USDT',
    name: 'Bitcoin',
    category: 'Crypto',
    decimals: 2,
    source: 'binance',
  },
  {
    id: 'EURUSD',
    label: 'Euro / Dollar',
    symbol: 'OANDA:EUR_USD',
    displaySymbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    category: 'Forex',
    decimals: 5,
    source: 'finnhub',
  },
  {
    id: 'GBPUSD',
    label: 'Pound / Dollar',
    symbol: 'OANDA:GBP_USD',
    displaySymbol: 'GBP/USD',
    name: 'British Pound / US Dollar',
    category: 'Forex',
    decimals: 5,
    source: 'finnhub',
  },
  {
    id: 'USDJPY',
    label: 'Dollar / Yen',
    symbol: 'OANDA:USD_JPY',
    displaySymbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    category: 'Forex',
    decimals: 3,
    source: 'finnhub',
  },
  {
    id: 'GOLD',
    label: 'Gold',
    symbol: 'OANDA:XAU_USD',
    displaySymbol: 'XAU/USD',
    name: 'Gold Spot',
    category: 'Metals',
    decimals: 2,
    source: 'finnhub',
  },
  {
    id: 'ETH',
    label: 'Ethereum',
    symbol: 'ETHUSDT',
    displaySymbol: 'ETH/USDT',
    name: 'Ethereum',
    category: 'Crypto',
    decimals: 2,
    source: 'binance',
  },
  {
    id: 'XRP',
    label: 'XRP',
    symbol: 'XRPUSDT',
    displaySymbol: 'XRP/USDT',
    name: 'XRP',
    category: 'Crypto',
    decimals: 4,
    source: 'binance',
  },
  {
    id: 'SOL',
    label: 'Solana',
    symbol: 'SOLUSDT',
    displaySymbol: 'SOL/USDT',
    name: 'Solana',
    category: 'Crypto',
    decimals: 2,
    source: 'binance',
  },
  {
    id: 'BCH',
    label: 'Bitcoin Cash',
    symbol: 'BCHUSDT',
    displaySymbol: 'BCH/USDT',
    name: 'Bitcoin Cash',
    category: 'Crypto',
    decimals: 2,
    source: 'binance',
  },
  {
    id: 'LTC',
    label: 'Litecoin',
    symbol: 'LTCUSDT',
    displaySymbol: 'LTC/USDT',
    name: 'Litecoin',
    category: 'Crypto',
    decimals: 2,
    source: 'binance',
  },
];

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1H', '4H', '1D'];

export const BINANCE_INTERVAL_MAP: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '1D': '1d',
};

export const FINNHUB_RESOLUTION_MAP: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1H': '60',
  '4H': '240',
  '1D': 'D',
};

export const TF_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};
