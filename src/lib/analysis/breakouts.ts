import type { Candle } from '@/types/trading';
import type { BreakoutEvent, SRLevel } from './types';
import { currentAtr } from './liquidity';

// ── Breakout / retest classification ────────────────────────────
// A WICK through a level is never a breakout. Rules (per S/R level, last 40 bars):
//   breakout            : one close ≥0.25 ATR beyond the level
//   confirmed-breakout  : a second consecutive close beyond it, OR a close beyond
//                         on volume ≥1.3× the 20-bar average (only when real volume exists)
//   false-breakout      : a close beyond the level was followed, within 5 bars,
//                         by a close back on the original side
//   retest-held         : after a confirmed breakout, price returned to the level
//                         and a bar closed back on the breakout side
//   failed-retest       : the return closed back through the level

const WINDOW = 40;

export function detectBreakouts(candles: Candle[], levels: SRLevel[]): BreakoutEvent[] {
  const n = candles.length;
  const a = currentAtr(candles);
  if (n < 30 || a <= 0) return [];
  const buffer = a * 0.25;
  const out: BreakoutEvent[] = [];

  const avgVol = (idx: number): number | null => {
    let s = 0, k = 0;
    for (let i = Math.max(0, idx - 20); i < idx; i++) {
      const v = candles[i].volume;
      if (v !== undefined && v > 0) { s += v; k++; }
    }
    return k >= 10 ? s / k : null;
  };

  for (const lvl of levels) {
    // Evaluate both directions for each level; the role is whichever side was crossed.
    for (const dir of ['bullish', 'bearish'] as const) {
      const above = (c: Candle) => c.close > lvl.price + buffer;
      const below = (c: Candle) => c.close < lvl.price - buffer;
      const beyond = dir === 'bullish' ? above : below;
      const back = (c: Candle) => dir === 'bullish' ? c.close < lvl.price : c.close > lvl.price;

      const start = Math.max(1, n - WINDOW);
      // first close beyond within the window, preceded by a close on the other side
      let bIdx = -1;
      for (let t = start; t < n; t++) {
        if (beyond(candles[t]) && !beyond(candles[t - 1])) { bIdx = t; break; }
      }
      if (bIdx === -1) continue;
      // A breakout needs price to have been on the ORIGINAL side beforehand: the previous
      // 5 closes must not be beyond the level (otherwise this is just a move back across it).
      let wasOriginalSide = bIdx >= 5;
      for (let k = 1; k <= 5 && wasOriginalSide; k++) {
        const pc = candles[bIdx - k].close;
        if (dir === 'bullish' ? pc > lvl.price + buffer : pc < lvl.price - buffer) wasOriginalSide = false;
      }
      if (!wasOriginalSide) continue;

      // false breakout?
      const failIdx = (() => {
        for (let t = bIdx + 1; t <= Math.min(n - 1, bIdx + 5); t++) if (back(candles[t])) return t;
        return -1;
      })();
      const confirmedFirst = bIdx + 1 < n && beyond(candles[bIdx + 1]);
      if (failIdx !== -1 && !(confirmedFirst && failIdx > bIdx + 1)) {
        out.push({ type: 'false-breakout', direction: dir, level: lvl.price, index: failIdx, time: candles[failIdx].time,
          note: `Closed ${dir === 'bullish' ? 'above' : 'below'} then back through the level within ${failIdx - bIdx} bar(s)` });
        continue;
      }

      const second = bIdx + 1 < n && beyond(candles[bIdx + 1]);
      const v = candles[bIdx].volume, av = avgVol(bIdx);
      const volOk = v !== undefined && av !== null && v >= av * 1.3;
      if (!(second || volOk)) {
        out.push({ type: 'breakout', direction: dir, level: lvl.price, index: bIdx, time: candles[bIdx].time,
          note: 'Single close beyond the level — not yet confirmed (needs a 2nd close or volume expansion)' });
        continue;
      }
      const confirmIdx = second ? bIdx + 1 : bIdx;
      out.push({ type: 'confirmed-breakout', direction: dir, level: lvl.price, index: confirmIdx, time: candles[confirmIdx].time,
        note: second ? 'Two consecutive closes beyond the level' : 'Close beyond the level on expanded volume' });

      // retest after confirmation
      for (let t = confirmIdx + 1; t < n; t++) {
        const c = candles[t];
        const touched = dir === 'bullish' ? c.low <= lvl.price + buffer : c.high >= lvl.price - buffer;
        if (!touched) continue;
        if (dir === 'bullish' ? c.close >= lvl.price : c.close <= lvl.price) {
          out.push({ type: 'retest-held', direction: dir, level: lvl.price, index: t, time: c.time, note: 'Price returned to the broken level and closed back on the breakout side' });
        } else {
          out.push({ type: 'failed-retest', direction: dir, level: lvl.price, index: t, time: c.time, note: 'Price returned and closed back through the broken level' });
        }
        break;
      }
    }
  }
  return out.sort((x, y) => y.index - x.index);
}
