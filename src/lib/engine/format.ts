const LOCALE = 'en-US';
const CURRENCY = 'USD';

const usd = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdCompact = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** cents → "$1,234.56" */
export function money(cents: number): string {
  return usd.format(cents / 100);
}

/** cents → short form ("$1.2M") for large values */
export function moneyShort(cents: number): string {
  return Math.abs(cents) >= 1_000_000 ? usdCompact.format(cents / 100) : usd.format(cents / 100);
}

/** Signed money: "+$10.00" / "−$10.00" */
export function moneySigned(cents: number): string {
  if (cents === 0) return money(0);
  return (cents > 0 ? '+' : '−') + money(Math.abs(cents));
}

/** Integer with thousands separators */
export function num(n: number): string {
  return int.format(n);
}

/** Plain number with up to 2 decimals (e.g. 0.1, 1,000) */
export function plainNum(n: number): string {
  return plain.format(n);
}

/** Ratio 0..1 → "48.65" (no percent sign) */
export function percent(ratio: number): string {
  return pct.format(ratio * 100);
}

/** Tiny probabilities as "1 in 312,000" */
export function oneIn(p: number): string {
  if (p <= 0) return '—';
  if (p >= 0.01) return percent(p) + '%';
  return '1 in ' + int.format(Math.round(1 / p));
}

/** Dollars (decimal) → cents (integer) */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Ordinal suffix: 1st, 2nd, 3rd, 4th, 11th, 21st … */
export function ordinal(n: number): string {
  const v = Math.abs(n) % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][v % 10] ?? 'th');
  return num(n) + suffix;
}
