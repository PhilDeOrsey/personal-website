// Pure, DOM-free FIRE simulation engine.
//
// Everything is in *real* (today's) dollars: we convert the nominal return and
// inflation into a single real return, so spending, Social Security, tax
// brackets, etc. all stay constant across the projection and the chart reads
// intuitively.

import {
  federalTax,
  requiredMinimumDistribution,
  STANDARD_DEDUCTION_MFJ,
  taxableSocialSecurity,
} from './tax.ts';

export interface IncomeEvent {
  /** Applied at the start of the year in which YOU reach this age. */
  atYourAge: number;
  who: 'you' | 'spouse';
  /** New gross annual income (today's dollars) for that person from then on. */
  newAnnual: number;
}

export interface Mortgage {
  /** Annual principal + interest payment (today's dollars). */
  annualPayment: number;
  /** Years of payments remaining from the current year. Payment ends after. */
  yearsRemaining: number;
}

export type TaxMode = 'effective' | 'brackets';
export type RetireMode = 'fixed' | 'earliest';

export interface FireInputs {
  // Household
  currentYear: number;
  yourAge: number;
  spouseAge: number;
  horizonAge: number; // your age at end of simulation

  // Account balances (today's dollars)
  cashBalance: number; // HYSA / cash — grows at its own (lower) rate
  taxableBalance: number;
  pretaxBalance: number; // combined you + spouse pre-tax
  rothBalance: number;

  // Annual contributions while working (today's dollars)
  cashContrib: number;
  cashCap: number; // once cash reaches this, cash contributions overflow to taxable (0 = no cap)
  taxableContrib: number;
  pretaxContrib: number;
  rothContrib: number;
  employerMatch: number; // added to pre-tax while working

  // Income (gross, today's dollars)
  yourIncome: number;
  spouseIncome: number;
  incomeEvents: IncomeEvent[];

  // Expenses
  annualSpend: number; // retirement spend target, excludes mortgage
  mortgage: Mortgage | null;

  // Market assumptions
  nominalReturn: number; // e.g. 0.07 — applies to taxable/pre-tax/Roth
  cashReturn: number; // e.g. 0.04 — applies to the cash/HYSA bucket
  inflation: number; // e.g. 0.03

  // Social Security (annual, today's dollars)
  ssYouAnnual: number;
  ssYouClaimAge: number;
  ssSpouseAnnual: number;
  ssSpouseClaimAge: number;

  // Taxes
  taxMode: TaxMode;
  effectiveTaxRate: number; // used when taxMode === 'effective'

  // Retirement
  retireMode: RetireMode;
  retireAge: number; // your age (used when retireMode === 'fixed')
  withdrawalRate: number; // for the FI-number crossover line, e.g. 0.04
}

export interface YearRow {
  year: number;
  yourAge: number;
  spouseAge: number;
  working: boolean;
  cash: number;
  taxable: number;
  pretax: number;
  roth: number;
  total: number;
  spend: number; // total spend incl. mortgage this year
  ssIncome: number;
  tax: number; // income tax on withdrawals + taxable SS
  penalty: number; // 10% early-withdrawal penalty on pre-59½ pre-tax draws
  fiNumber: number; // spend / withdrawal rate this year
}

export interface Projection {
  rows: YearRow[];
  realReturn: number;
  retireAge: number; // the age actually used (resolved if 'earliest')
  /**
   * Earliest age at which retiring is sustainable to the horizon (accounts for
   * mortgage payoff, Social Security, and taxes — not just the 4% crossover).
   * null if no age in range works.
   */
  fiAge: number | null;
  /** Your age when the portfolio is depleted during retirement, or null. */
  depletionAge: number | null;
  portfolioAtRetirement: number;
  endingBalance: number;
  success: boolean; // retired and never depleted through the horizon
}

export const realReturn = (nominal: number, inflation: number): number =>
  (1 + nominal) / (1 + inflation) - 1;

// Pre-tax (401k/IRA) withdrawals before 59½ incur a 10% penalty on top of tax.
const EARLY_WITHDRAWAL_AGE = 59.5;
const EARLY_WITHDRAWAL_PENALTY = 0.1;

/** Resolve a person's gross income at a given "your age", applying events. */
const incomeAt = (
  base: number,
  who: 'you' | 'spouse',
  yourAge: number,
  events: IncomeEvent[],
): number => {
  let value = base;
  for (const e of events) {
    if (e.who === who && yourAge >= e.atYourAge) value = e.newAnnual;
  }
  return value;
};

interface Buckets {
  cash: number;
  taxable: number;
  pretax: number;
  roth: number;
}

/**
 * Withdraw `net` after-tax dollars for the year, pulling cash → taxable →
 * pre-tax → Roth and accounting for tax on pre-tax withdrawals plus taxable
 * Social Security. Cash (HYSA) is drawn down first as a buffer. Pre-tax
 * withdrawals before age 59½ also incur the 10% early-withdrawal penalty (using
 * your age as the account-owner proxy). Mutates `b`. Returns the income tax, the
 * penalty, and the after-tax shortfall (if the buckets ran dry).
 */
const fundSpending = (
  b: Buckets,
  net: number,
  ssIncome: number,
  rmd: number,
  inputs: FireInputs,
  yourAge: number,
): { tax: number; penalty: number; shortfall: number } => {
  const penaltyRate = yourAge < EARLY_WITHDRAWAL_AGE ? EARLY_WITHDRAWAL_PENALTY : 0;

  // Tax on a given amount of ordinary (pre-tax + taxable-SS) income.
  const taxOn = (ordinaryFromPretax: number): number => {
    if (inputs.taxMode === 'effective') {
      return (ordinaryFromPretax + ssIncome) * inputs.effectiveTaxRate;
    }
    const ssTaxable = taxableSocialSecurity(ssIncome, ordinaryFromPretax);
    return federalTax(ordinaryFromPretax + ssTaxable - STANDARD_DEDUCTION_MFJ);
  };

  // Forced RMD first: it comes out of pre-tax whether we need it or not. (RMDs
  // begin at 73, so they never overlap the early-withdrawal penalty.)
  let pretaxDrawn = Math.min(rmd, b.pretax);
  b.pretax -= pretaxDrawn;

  let remaining = net - ssIncome; // RMD cash is applied to need below
  let cash = b.cash;
  let taxable = b.taxable;
  let roth = b.roth;

  // Apply the after-tax proceeds of the forced RMD toward this year's need.
  const rmdTax = taxOn(pretaxDrawn);
  remaining -= pretaxDrawn - rmdTax;

  // 1) Cash / HYSA bucket first, as the spending buffer (tax-free to draw).
  if (remaining > 0) {
    const take = Math.min(remaining, cash);
    cash -= take;
    remaining -= take;
  }

  // 2) Taxable bucket (treat basis as already spent; ignore cap-gains for the
  //    approximation — conservative enough for a planning tool).
  if (remaining > 0) {
    const take = Math.min(remaining, taxable);
    taxable -= take;
    remaining -= take;
  }

  // 3) Pre-tax bucket, grossed up to cover the marginal tax AND the early
  //    withdrawal penalty it creates.
  if (remaining > 0 && b.pretax > 0) {
    // Fixed-point iteration to converge on the gross withdrawal needed so that
    // (gross − incremental tax − penalty) === remaining.
    let gross = remaining;
    for (let i = 0; i < 24; i++) {
      const incrementalTax = taxOn(pretaxDrawn + gross) - taxOn(pretaxDrawn);
      gross = remaining + incrementalTax + penaltyRate * gross;
    }
    const take = Math.min(gross, b.pretax);
    b.pretax -= take;
    pretaxDrawn += take;
    if (take >= gross) {
      // Pre-tax fully covered the grossed-up need — no residual. (Avoids a
      // phantom shortfall from float/convergence noise while plenty remains.)
      remaining = 0;
    } else {
      // Pre-tax ran dry; pass the still-unfunded after-tax remainder onward.
      const net2 = take - (taxOn(pretaxDrawn) - taxOn(pretaxDrawn - take)) - penaltyRate * take;
      remaining -= net2;
    }
  }

  // 4) Roth bucket (tax-free).
  if (remaining > 0) {
    const take = Math.min(remaining, roth);
    roth -= take;
    remaining -= take;
  }

  // Any leftover RMD cash beyond this year's need flows into the taxable bucket.
  if (remaining < 0) {
    taxable += -remaining;
    remaining = 0;
  }

  b.cash = cash;
  b.taxable = taxable;
  b.roth = roth;

  return {
    tax: taxOn(pretaxDrawn),
    penalty: penaltyRate * pretaxDrawn,
    shortfall: Math.max(0, remaining),
  };
};

/** Run the full year-by-year projection for an explicit retirement age. */
const project = (inputs: FireInputs, retireAge: number): Projection => {
  const r = realReturn(inputs.nominalReturn, inputs.inflation);
  const rCash = realReturn(inputs.cashReturn, inputs.inflation);
  const rows: YearRow[] = [];

  const b: Buckets = {
    cash: inputs.cashBalance,
    taxable: inputs.taxableBalance,
    pretax: inputs.pretaxBalance,
    roth: inputs.rothBalance,
  };

  let depletionAge: number | null = null;
  let portfolioAtRetirement = 0;
  const yearsSpan = inputs.horizonAge - inputs.yourAge;

  for (let i = 0; i <= yearsSpan; i++) {
    const yourAge = inputs.yourAge + i;
    const spouseAge = inputs.spouseAge + i;
    const year = inputs.currentYear + i;
    const working = yourAge < retireAge;

    // Growth on all buckets (start-of-year balance grows through the year).
    b.cash *= 1 + rCash;
    b.taxable *= 1 + r;
    b.pretax *= 1 + r;
    b.roth *= 1 + r;

    // Hold the cash/HYSA bucket at its cap: interest accruing above the cap is
    // swept into the brokerage (where it earns the investment return).
    if (inputs.cashCap > 0 && b.cash > inputs.cashCap) {
      b.taxable += b.cash - inputs.cashCap;
      b.cash = inputs.cashCap;
    }

    let ssIncome = 0;
    let tax = 0;
    let penalty = 0;

    const mortgageActive =
      inputs.mortgage !== null && i < inputs.mortgage.yearsRemaining;
    const mortgagePayment = mortgageActive ? inputs.mortgage!.annualPayment : 0;

    if (working) {
      // Contributions are funded from income, so they're capped by the surplus
      // left after spending. Income-change events (a raise, going part-time, a
      // spouse stopping work) flow straight through to how much can be saved.
      const household =
        incomeAt(inputs.yourIncome, 'you', yourAge, inputs.incomeEvents) +
        incomeAt(inputs.spouseIncome, 'spouse', yourAge, inputs.incomeEvents);
      const workSpend = inputs.annualSpend + mortgagePayment;
      const desired =
        inputs.cashContrib + inputs.taxableContrib + inputs.pretaxContrib + inputs.rothContrib;
      const surplus = Math.max(0, household - workSpend);
      const scale = desired > 0 ? Math.min(1, surplus / desired) : 0;

      // Cash contributions fill the HYSA up to its cap; anything beyond the cap
      // overflows into the brokerage (taxable) bucket. 0 means no cap.
      const cap = inputs.cashCap > 0 ? inputs.cashCap : Infinity;
      const intendedCash = inputs.cashContrib * scale;
      const cashAdd = Math.min(intendedCash, Math.max(0, cap - b.cash));
      const overflow = intendedCash - cashAdd;

      b.cash += cashAdd;
      b.taxable += inputs.taxableContrib * scale + overflow;
      b.pretax += inputs.pretaxContrib * scale + (household > 0 ? inputs.employerMatch : 0);
      b.roth += inputs.rothContrib * scale;
    } else {
      // Retired: portfolio funds spending net of Social Security.
      if (yourAge >= inputs.ssYouClaimAge) ssIncome += inputs.ssYouAnnual;
      if (spouseAge >= inputs.ssSpouseClaimAge) ssIncome += inputs.ssSpouseAnnual;

      const spendNeed = inputs.annualSpend + mortgagePayment;
      const rmd = requiredMinimumDistribution(b.pretax, yourAge);
      const result = fundSpending(b, spendNeed, ssIncome, rmd, inputs, yourAge);
      tax = result.tax;
      penalty = result.penalty;
      // Treat sub-dollar gaps as rounding, not depletion.
      if (result.shortfall > 1 && depletionAge === null) depletionAge = yourAge;
    }

    // Clamp tiny negative balances from rounding.
    b.cash = Math.max(0, b.cash);
    b.taxable = Math.max(0, b.taxable);
    b.pretax = Math.max(0, b.pretax);
    b.roth = Math.max(0, b.roth);

    const total = b.cash + b.taxable + b.pretax + b.roth;
    const spend = working ? 0 : inputs.annualSpend + mortgagePayment;
    // Reference target: 25× core spend (the classic 4%-rule number). Mortgage is
    // excluded because it's temporary; this is a stable horizontal line.
    const fiNumber = inputs.annualSpend / inputs.withdrawalRate;

    if (yourAge === retireAge) portfolioAtRetirement = total;

    rows.push({
      year,
      yourAge,
      spouseAge,
      working,
      cash: b.cash,
      taxable: b.taxable,
      pretax: b.pretax,
      roth: b.roth,
      total,
      spend,
      ssIncome,
      tax,
      penalty,
      fiNumber,
    });
  }

  const endingBalance = rows.length ? rows[rows.length - 1].total : 0;
  return {
    rows,
    realReturn: r,
    retireAge,
    fiAge: null, // filled in by simulate()
    depletionAge,
    portfolioAtRetirement,
    endingBalance,
    success: depletionAge === null && retireAge <= inputs.horizonAge,
  };
};

/**
 * Find the earliest retirement age (>= current age) whose projection survives
 * to the horizon without depleting, or null if none in range works.
 */
const earliestSustainableAge = (inputs: FireInputs): number | null => {
  for (let age = inputs.yourAge; age <= inputs.horizonAge; age++) {
    if (project(inputs, age).depletionAge === null) return age;
  }
  return null;
};

/** Top-level entry: resolve the retirement age per mode and run the projection. */
export const simulate = (inputs: FireInputs): Projection => {
  const fiAge = earliestSustainableAge(inputs);
  const retireAge =
    inputs.retireMode === 'earliest' ? (fiAge ?? inputs.horizonAge) : inputs.retireAge;
  return { ...project(inputs, retireAge), fiAge };
};

export interface RequiredPoint {
  age: number;
  required: number; // minimum total portfolio (today's $) to retire AT this age
}

/**
 * The SS-aware "required portfolio" curve: for each age, the minimum total
 * portfolio you'd need to retire then and last to the horizon — crediting
 * Social Security (which turns on later), mortgage payoff, and taxes. It's high
 * when young (long bridge, no SS yet) and descends as you near the claim age.
 * Where your projected net-worth line crosses it = your FI age.
 *
 * The candidate portfolio is split across buckets using your *projected* mix at
 * that age (so the tax treatment is realistic). Note: like the rest of the
 * model, this ignores the 10% penalty on pre-59½ pre-tax withdrawals, so very
 * early ages are slightly optimistic.
 */
export const requiredPortfolioCurve = (
  inputs: FireInputs,
  baseRows: YearRow[],
): RequiredPoint[] => {
  const mixByAge = new Map<number, YearRow>();
  baseRows.forEach((r) => mixByAge.set(r.yourAge, r));

  const out: RequiredPoint[] = [];
  for (let age = inputs.yourAge; age < inputs.horizonAge; age++) {
    const row = mixByAge.get(age);
    const total = row ? row.total : 0;
    const props =
      row && total > 0
        ? { cash: row.cash / total, taxable: row.taxable / total, pretax: row.pretax / total, roth: row.roth / total }
        : { cash: 0, taxable: 0, pretax: 1, roth: 0 };

    const yearsFromNow = age - inputs.yourAge;
    const makeSub = (T: number): FireInputs => ({
      ...inputs,
      yourAge: age,
      spouseAge: inputs.spouseAge + yearsFromNow,
      currentYear: inputs.currentYear + yearsFromNow,
      cashBalance: T * props.cash,
      taxableBalance: T * props.taxable,
      pretaxBalance: T * props.pretax,
      rothBalance: T * props.roth,
      cashContrib: 0,
      taxableContrib: 0,
      pretaxContrib: 0,
      rothContrib: 0,
      employerMatch: 0,
      incomeEvents: [],
      mortgage: inputs.mortgage
        ? {
            annualPayment: inputs.mortgage.annualPayment,
            yearsRemaining: Math.max(0, inputs.mortgage.yearsRemaining - yearsFromNow),
          }
        : null,
      retireMode: 'fixed',
      retireAge: age,
    });
    const survives = (T: number): boolean => project(makeSub(T), age).depletionAge === null;

    // Bracket the answer, then binary-search the minimum surviving portfolio.
    let lo = 0;
    let hi = inputs.annualSpend * 40 + 1;
    let guard = 0;
    while (!survives(hi) && guard++ < 8) hi *= 1.8;
    for (let it = 0; it < 20; it++) {
      const mid = (lo + hi) / 2;
      if (survives(mid)) hi = mid;
      else lo = mid;
    }
    out.push({ age, required: hi });
  }
  return out;
};

export interface BridgeBreakdown {
  fiAge: number | null;
  ssStartAge: number; // earliest of the two claim ages
  bridgeYears: number; // from FI age to SS turning on
  spendDuringBridge: number; // core annual spend funded fully from portfolio
  totalSS: number; // combined annual SS once both have claimed
  postSsGap: number; // spend not covered by SS
  postSsNeed: number; // portfolio to fund that gap at the withdrawal rate
}

/** The two-phase "bridge to Social Security" view of the plan. */
export const bridgeBreakdown = (inputs: FireInputs, fiAge: number | null): BridgeBreakdown => {
  const ssStartAge = Math.min(inputs.ssYouClaimAge, inputs.ssSpouseClaimAge);
  const totalSS = inputs.ssYouAnnual + inputs.ssSpouseAnnual;
  const from = fiAge ?? inputs.retireAge;
  const postSsGap = Math.max(0, inputs.annualSpend - totalSS);
  return {
    fiAge,
    ssStartAge,
    bridgeYears: Math.max(0, ssStartAge - from),
    spendDuringBridge: inputs.annualSpend,
    totalSS,
    postSsGap,
    postSsNeed: postSsGap / inputs.withdrawalRate,
  };
};

/** Generic, non-personal starting point. Real numbers are entered at runtime. */
export const defaultInputs = (currentYear: number): FireInputs => ({
  currentYear,
  yourAge: 35,
  spouseAge: 35,
  horizonAge: 95,

  cashBalance: 20_000,
  taxableBalance: 50_000,
  pretaxBalance: 150_000,
  rothBalance: 25_000,

  cashContrib: 3_000,
  cashCap: 50_000,
  taxableContrib: 10_000,
  pretaxContrib: 20_000,
  rothContrib: 7_000,
  employerMatch: 5_000,

  yourIncome: 100_000,
  spouseIncome: 60_000,
  incomeEvents: [],

  annualSpend: 70_000,
  mortgage: { annualPayment: 24_000, yearsRemaining: 20 },

  nominalReturn: 0.07,
  cashReturn: 0.04,
  inflation: 0.03,

  ssYouAnnual: 30_000,
  ssYouClaimAge: 67,
  ssSpouseAnnual: 20_000,
  ssSpouseClaimAge: 67,

  taxMode: 'effective',
  effectiveTaxRate: 0.15,

  retireMode: 'earliest',
  retireAge: 55,
  withdrawalRate: 0.04,
});
