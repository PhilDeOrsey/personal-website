// Simplified federal tax helpers for the FIRE projection.
//
// These are deliberate approximations for planning, NOT tax advice:
//  - Married-filing-jointly only, standard deduction, federal brackets only.
//  - Brackets and the standard deduction are treated as inflation-indexed, so we
//    can work entirely in today's dollars (real terms).
//  - Social Security taxability is approximated with the 50%/85% thresholds.
//  - RMD divisors use the IRS Uniform Lifetime Table.
//
// All amounts are today's dollars.

/** 2024-ish MFJ standard deduction (real dollars). */
export const STANDARD_DEDUCTION_MFJ = 29_200;

/** 2024-ish MFJ federal brackets: [upTo, rate]. Last bracket uses Infinity. */
const MFJ_BRACKETS: ReadonlyArray<readonly [number, number]> = [
  [23_200, 0.1],
  [94_300, 0.12],
  [201_050, 0.22],
  [383_900, 0.24],
  [487_450, 0.32],
  [731_200, 0.35],
  [Infinity, 0.37],
];

/** Federal income tax on a given taxable income (after deductions), MFJ. */
export const federalTax = (taxableIncome: number): number => {
  let income = Math.max(0, taxableIncome);
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of MFJ_BRACKETS) {
    if (income <= 0) break;
    const span = Math.min(income, upTo - lower);
    tax += span * rate;
    income -= span;
    lower = upTo;
  }
  return tax;
};

/**
 * Approximate the taxable portion of Social Security benefits (MFJ), using
 * provisional income against the $32k / $44k thresholds.
 * `otherTaxableIncome` is ordinary taxable income excluding SS.
 */
export const taxableSocialSecurity = (ssBenefits: number, otherTaxableIncome: number): number => {
  if (ssBenefits <= 0) return 0;
  const provisional = otherTaxableIncome + ssBenefits / 2;
  if (provisional <= 32_000) return 0;
  if (provisional <= 44_000) {
    return Math.min(0.5 * (provisional - 32_000), 0.5 * ssBenefits);
  }
  const lowerTier = Math.min(0.5 * (44_000 - 32_000), 0.5 * ssBenefits);
  return Math.min(0.85 * ssBenefits, 0.85 * (provisional - 44_000) + lowerTier);
};

// IRS Uniform Lifetime Table divisors by age (73+). RMDs begin at 73.
const RMD_DIVISORS: Record<number, number> = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
  94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
};

export const RMD_START_AGE = 73;

/** Required minimum distribution for a pre-tax balance at a given age (0 if none). */
export const requiredMinimumDistribution = (pretaxBalance: number, age: number): number => {
  if (age < RMD_START_AGE || pretaxBalance <= 0) return 0;
  const divisor = RMD_DIVISORS[Math.min(age, 100)] ?? 6.4;
  return pretaxBalance / divisor;
};
