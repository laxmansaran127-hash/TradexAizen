export const money = (v: number | null | undefined, signed = false): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : signed && v > 0 ? '+' : ''}$${s}`;
};
export const pct = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);
export const price = (v: number | null | undefined, decimals: number): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(decimals));
export const when = (sec: number | null | undefined): string => (sec ? new Date(sec * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export const ago = (sec: number | null | undefined, nowSec: number): string => {
  if (!sec) return 'never';
  const d = Math.max(0, nowSec - sec);
  return d < 90 ? `${d}s ago` : d < 5400 ? `${Math.round(d / 60)}m ago` : `${(d / 3600).toFixed(1)}h ago`;
};
export const pnlColor = (v: number | null | undefined): string => (!v ? 'text-slate-300' : v > 0 ? 'text-emerald-400' : 'text-red-400');

/** CSV with every history field, tagged PAPER. Cells are quoted so commas in reasoning cannot break the file. */
export function tradesToCsv(rows: { [k: string]: unknown }[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}
