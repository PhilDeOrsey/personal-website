// Formatting helpers for the FIRE calculator. All values are in today's dollars.

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Full dollar amount, e.g. $1,234,567 */
export const money = (n: number): string => usd.format(Math.round(n));

/** Abbreviated dollars for axis ticks, e.g. $1.2M, $750k, $0 */
export const moneyShort = (n: number): string => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
};

/** A fraction like 0.07 → "7%" */
export const percent = (frac: number, digits = 1): string => `${(frac * 100).toFixed(digits)}%`;

/** A count of years → "12 yrs" / "1 yr" */
export const years = (n: number): string => `${n} ${n === 1 ? 'yr' : 'yrs'}`;
