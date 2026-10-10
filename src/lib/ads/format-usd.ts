/** Compact USD for dashboard tiles: $9,876 · $12.4k · $456k · $1.23M. */
export function compactUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 999_500) return `${s}$${(a / 1_000_000).toFixed(a >= 100_000_000 ? 0 : a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 10_000) return `${s}$${(a / 1000).toFixed(a >= 99_950 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `${s}$${Math.round(a).toLocaleString('en-US')}`;
}
