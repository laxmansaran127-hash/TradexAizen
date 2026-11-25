import type { Asset } from '@/types/trading';
import { ASSET_CONFIGS } from '@/types/trading';
import type { InstrumentSpec, MarketCategory } from './types';

// Execution-cost numbers below are PAPER-TRADING ASSUMPTIONS (documented defaults),
// not quotes from any exchange or broker. Replace with measured values before relying on results.

export function categoryOf(assetId: Asset): MarketCategory {
  const c = ASSET_CONFIGS.find(a => a.id === assetId)?.category;
  return c === 'Crypto' ? 'crypto' : c === 'Forex' ? 'forex' : 'gold';
}

export function getSpec(assetId: Asset): InstrumentSpec {
  const cfg = ASSET_CONFIGS.find(a => a.id === assetId);
  if (!cfg) throw new Error(`Unknown asset ${assetId}`);
  const category = categoryOf(assetId);
  const base = { assetId, displaySymbol: cfg.displaySymbol, category };
  if (category === 'crypto') {
    return { ...base, baseIsUsd: false, quoteCcy: 'USD', qtyStep: 0.000001, minNotionalUsd: 10, feeBps: 10, slippageBps: 2, assumedSpreadBps: 2 };
  }
  if (category === 'gold') {
    return { ...base, baseIsUsd: false, quoteCcy: 'USD', qtyStep: 0.01, minNotionalUsd: 10, feeBps: 0, slippageBps: 1, assumedSpreadBps: 3 };
  }
  // forex: micro-lot (1,000 units) steps
  return { ...base, baseIsUsd: assetId === 'USDJPY', quoteCcy: assetId === 'USDJPY' ? 'JPY' : 'USD', qtyStep: 1000, minNotionalUsd: 10, feeBps: 0, slippageBps: 0.5, assumedSpreadBps: 1 };
}

/** Multiply a quote-currency amount by this to get USD at `price`. */
export function quoteToUsd(spec: InstrumentSpec, price: number): number {
  return spec.quoteCcy === 'JPY' ? 1 / price : 1;
}

export function notionalUsd(spec: InstrumentSpec, qty: number, price: number): number {
  return spec.baseIsUsd ? qty : qty * price;
}

/** Signed P&L in USD for `qty` base units moving from entry to exit. */
export function pnlUsd(spec: InstrumentSpec, dir: 1 | -1, entry: number, exit: number, qty: number): number {
  return dir * (exit - entry) * qty * quoteToUsd(spec, exit);
}

export function floorToStep(v: number, step: number): number {
  const n = Math.floor(v / step + 1e-9);
  return Number((n * step).toFixed(8));
}
