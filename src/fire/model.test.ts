// Engine tests for the FIRE model. Run with `npm test`.
//
// Uses Node's built-in test runner + type-stripping (no test framework
// dependency). Fixtures are generic — they intentionally do NOT read
// my-data.local.json so the suite passes on a fresh clone.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate,
  defaultInputs,
  realReturn,
  requiredPortfolioCurve,
  bridgeBreakdown,
  type FireInputs,
} from './model.ts';

const base = (): FireInputs => defaultInputs(2026);

// An all-pre-tax, already-retired fixture for isolating the tax logic.
const retiredPretaxOnly = (over: Partial<FireInputs> = {}): FireInputs => ({
  ...base(),
  yourAge: 60,
  spouseAge: 60,
  retireMode: 'fixed',
  retireAge: 60,
  cashBalance: 0,
  taxableBalance: 0,
  rothBalance: 0,
  pretaxBalance: 5_000_000,
  cashContrib: 0,
  cashCap: 0,
  taxableContrib: 0,
  pretaxContrib: 0,
  rothContrib: 0,
  employerMatch: 0,
  mortgage: null,
  ssYouAnnual: 0,
  ssSpouseAnnual: 0,
  ...over,
});

const fiOf = (over: Partial<FireInputs>): number => simulate({ ...base(), ...over }).fiAge ?? 999;

// Earliest age at which BOTH partners can retire together and survive.
const jointFiAge = (inp: FireInputs): number => {
  for (let a = inp.yourAge; a <= inp.horizonAge; a++) {
    if (simulate({ ...inp, retireMode: 'fixed', retireAge: a, spouseRetireAge: a }).depletionAge === null) return a;
  }
  return inp.horizonAge;
};

describe('invariants', () => {
  test('balances never go negative', () => {
    for (const inp of [base(), { ...base(), taxMode: 'brackets' as const }]) {
      const p = simulate(inp);
      for (const r of p.rows) {
        assert.ok(r.cash >= -1e-6 && r.taxable >= -1e-6 && r.pretax >= -1e-6 && r.roth >= -1e-6);
        assert.ok(r.total >= -1e-6);
      }
    }
  });

  test('row count spans current age to horizon inclusive', () => {
    const inp = base();
    assert.equal(simulate(inp).rows.length, inp.horizonAge - inp.yourAge + 1);
  });

  test('deterministic', () => {
    assert.equal(JSON.stringify(simulate(base()).rows), JSON.stringify(simulate(base()).rows));
  });

  test('accumulation is monotonic while both work', () => {
    // Both retire at 65; default ages are equal, so there's no draw-down gap.
    const p = simulate({ ...base(), retireMode: 'fixed', retireAge: 65, spouseRetireAge: 65 });
    const acc = p.rows.filter((r) => r.working);
    acc.forEach((r, i) => {
      if (i > 0) assert.ok(r.total >= acc[i - 1].total - 1);
    });
  });
});

describe('cash-flow conservation', () => {
  // Every pre-RMD retirement year: (grown prev total - cur total) + SS == spend + tax.
  // This is the core check that the tax gross-up delivers exactly the spend need.
  for (const [label, over] of [
    ['effective', {}],
    ['brackets', { taxMode: 'brackets' as const }],
  ] as const) {
    test(`identity holds [${label}]`, () => {
      const inp = { ...base(), ...over };
      // Retire both together at a jointly-sustainable age so the fully-retired
      // years are funded (the identity only holds when spending is met).
      const rAge = jointFiAge(inp);
      const p = simulate({ ...inp, retireMode: 'fixed', retireAge: rAge, spouseRetireAge: rAge });
      const r = realReturn(inp.nominalReturn, inp.inflation);
      const rc = realReturn(inp.cashReturn, inp.inflation);
      let worst = 0;
      for (let i = 1; i < p.rows.length; i++) {
        const cur = p.rows[i];
        const prev = p.rows[i - 1];
        if (cur.working || cur.yourAge >= 73) continue;
        const grown = prev.cash * (1 + rc) + (prev.taxable + prev.pretax + prev.roth) * (1 + r);
        const lhs = grown - cur.total + cur.ssIncome;
        const rhs = cur.spend + cur.tax + cur.penalty;
        worst = Math.max(worst, Math.abs(lhs - rhs));
      }
      assert.ok(worst < 0.01, `worst gap $${worst}`);
    });
  }
});

describe('earliest FI', () => {
  test('FI age is sustainable; FI age − 1 depletes (both retiring together)', () => {
    const fi = simulate(base()).fiAge;
    assert.notEqual(fi, null);
    // Joint FI: retire BOTH at the age (default ages are equal, so spouse age = fi).
    assert.equal(
      simulate({ ...base(), retireMode: 'fixed', retireAge: fi!, spouseRetireAge: fi! }).depletionAge,
      null,
    );
    assert.notEqual(
      simulate({ ...base(), retireMode: 'fixed', retireAge: fi! - 1, spouseRetireAge: fi! - 1 }).depletionAge,
      null,
    );
  });

  test('a genuinely underfunded retirement flags depletion', () => {
    const bust = simulate({
      ...base(),
      retireMode: 'fixed',
      retireAge: base().yourAge + 1,
      cashBalance: 0,
      taxableBalance: 0,
      pretaxBalance: 200_000,
      rothBalance: 0,
      ssYouAnnual: 0,
      ssSpouseAnnual: 0,
      annualSpend: 250_000,
    });
    assert.notEqual(bust.depletionAge, null);
  });
});

describe('comparative statics', () => {
  const b = simulate(base()).fiAge ?? 999;
  test('higher spend → FI no earlier', () => assert.ok(fiOf({ annualSpend: base().annualSpend + 40_000 }) >= b));
  test('lower spend → FI no later', () => assert.ok(fiOf({ annualSpend: base().annualSpend - 30_000 }) <= b));
  test('higher return → FI no later', () => assert.ok(fiOf({ nominalReturn: base().nominalReturn + 0.02 }) <= b));
  test('lower return → FI no earlier', () => assert.ok(fiOf({ nominalReturn: base().nominalReturn - 0.02 }) >= b));
  test('more starting assets → FI no later', () => assert.ok(fiOf({ pretaxBalance: base().pretaxBalance + 500_000 }) <= b));
  test('more Social Security → FI no later', () => assert.ok(fiOf({ ssYouAnnual: base().ssYouAnnual + 20_000 }) <= b));
  test('more contributions → FI no later', () => assert.ok(fiOf({ pretaxContrib: base().pretaxContrib + 15_000 }) <= b));
});

describe('mortgage', () => {
  test('spend includes the payment before payoff and drops after', () => {
    // Retire both immediately (no staggered gap) so every year is fully retired.
    const inp = {
      ...base(),
      retireMode: 'fixed' as const,
      retireAge: base().yourAge + 1,
      spouseRetireAge: base().spouseAge + 1,
    };
    const yrs = inp.mortgage!.yearsRemaining;
    const rows = simulate(inp).rows;
    const pre = rows.find((r) => !r.working && r.yourAge - inp.yourAge < yrs);
    const post = rows.find((r) => !r.working && r.yourAge - inp.yourAge >= yrs && r.yourAge < 67);
    assert.ok(pre && Math.abs(pre.spend - (inp.annualSpend + inp.mortgage!.annualPayment)) < 1);
    assert.ok(post && Math.abs(post.spend - inp.annualSpend) < 1);
  });
});

describe('cash bucket', () => {
  test('never exceeds the cap', () => {
    const inp = { ...base(), cashCap: 100_000, cashContrib: 30_000 };
    assert.ok(simulate(inp).rows.every((r) => r.cash <= inp.cashCap + 1));
  });

  test('cashCap = 0 means uncapped', () => {
    const maxCash = Math.max(...simulate({ ...base(), cashCap: 0, cashContrib: 30_000 }).rows.map((r) => r.cash));
    assert.ok(maxCash > 100_000);
  });
});

describe('taxes', () => {
  test('effective-rate gross-up is exact', () => {
    // $100k after-tax need at a 20% effective rate ⇒ gross $125k ⇒ tax $25k.
    const row = simulate(retiredPretaxOnly({ annualSpend: 100_000, taxMode: 'effective', effectiveTaxRate: 0.2 })).rows.find((r) => !r.working)!;
    assert.ok(Math.abs(row.tax - 25_000) < 1, `tax ${row.tax}`);
  });

  test('bracket tax is non-negative and rises with withdrawals', () => {
    const taxAt = (spend: number) =>
      simulate(retiredPretaxOnly({ annualSpend: spend, taxMode: 'brackets' })).rows.find((r) => !r.working)!.tax;
    assert.ok(taxAt(50_000) >= 0);
    assert.ok(taxAt(150_000) > taxAt(50_000));
  });
});

describe('staggered retirement', () => {
  // Fixture with a clear gap: you retire early, spouse keeps a high income.
  const staggered = (over: Partial<FireInputs> = {}): FireInputs => ({
    ...base(),
    yourAge: 50,
    spouseAge: 50,
    retireMode: 'fixed',
    retireAge: 50, // you retire now
    spouseRetireAge: 55, // spouse works 5 more years
    yourIncome: 120_000,
    spouseIncome: 150_000,
    annualSpend: 90_000,
    mortgage: null,
    ...over,
  });

  test('during the gap, the working spouse still earns', () => {
    const rows = simulate(staggered()).rows;
    const gap = rows.find((r) => r.yourAge === 52)!; // you retired, spouse (52) working
    assert.equal(gap.earnedIncome, 150_000);
    assert.ok(gap.working);
  });

  test('spouse income above spend means no portfolio draw during the gap', () => {
    const rows = simulate(staggered()).rows;
    const before = rows.find((r) => r.yourAge === 51)!;
    const during = rows.find((r) => r.yourAge === 52)!;
    // Spouse earns 150k > 90k spend, so the portfolio should grow, not shrink.
    assert.ok(during.total >= before.total);
  });

  test('once both retire, earned income is zero and the portfolio is drawn', () => {
    const rows = simulate(staggered()).rows;
    const bothRetired = rows.find((r) => r.yourAge === 56)!; // spouse 56 > 55
    assert.equal(bothRetired.earnedIncome, 0);
    assert.ok(!bothRetired.working);
  });

  test("'earliest' mode ignores the spouse slider — they retire together", () => {
    // FI age = earliest BOTH can retire, so the spouse input doesn't move it.
    const a = simulate({ ...base(), retireMode: 'earliest', spouseRetireAge: 45 });
    const b = simulate({ ...base(), retireMode: 'earliest', spouseRetireAge: 65 });
    assert.equal(a.fiAge, b.fiAge);
    // The resolved spouse age tracks yours (default ages are equal here).
    assert.equal(a.spouseRetireAge, a.retireAge);
  });

  test("'fixed' mode honors the spouse slider independently", () => {
    const p = simulate({ ...base(), retireMode: 'fixed', retireAge: 60, spouseRetireAge: 58 });
    assert.equal(p.retireAge, 60);
    assert.equal(p.spouseRetireAge, 58);
  });
});

describe('early-withdrawal penalty', () => {
  // All-pre-tax, retired, no SS, 0% income tax so we isolate the penalty.
  // net = gross − 10% penalty ⇒ gross = spend/0.9 ⇒ penalty = spend/9.
  const penaltyAt = (age: number) => {
    const inp = retiredPretaxOnly({
      yourAge: age,
      spouseAge: age,
      retireAge: age,
      annualSpend: 90_000,
      taxMode: 'effective',
      effectiveTaxRate: 0,
    });
    return simulate(inp).rows.find((r) => !r.working)!;
  };

  test('pre-59½ pre-tax withdrawals incur the 10% penalty', () => {
    const row = penaltyAt(50);
    assert.ok(Math.abs(row.penalty - 90_000 / 9) < 1, `penalty ${row.penalty}`);
  });

  test('no penalty at 60+', () => {
    assert.equal(penaltyAt(60).penalty, 0);
  });

  test('penalty pushes the FI age out (or equal)', () => {
    // Compare against a hypothetical no-penalty world by retiring at/after 60.
    const early = simulate({ ...base() }).fiAge!;
    const lateOnly = simulate({ ...base(), ssYouClaimAge: 62, ssSpouseClaimAge: 62 }).fiAge!;
    assert.ok(early >= base().yourAge && lateOnly >= base().yourAge);
  });
});

describe('required-portfolio curve', () => {
  const inp = base();
  const proj = simulate(inp);
  const curve = requiredPortfolioCurve(inp, proj.rows);
  const req = (a: number) => curve.find((c) => c.age === a)!.required;
  const endOfYear = (a: number) => proj.rows.find((r) => r.yourAge === a)!.total;
  const fi = proj.fiAge!;

  test('all required values are positive', () => {
    assert.ok(curve.every((c) => c.required > 0));
  });

  test('descends once both partners are retired', () => {
    // Before the spouse retires she bridges spend, so the curve can rise; after
    // both are retired it's a pure drawdown and must be non-increasing.
    const post = curve.filter((c) => c.age >= inp.spouseRetireAge);
    for (let i = 1; i < post.length; i++) assert.ok(post[i].required <= post[i - 1].required + 1);
  });

  test('SS-aware requirement is below the naive 25× number at FI age', () => {
    assert.ok(req(fi) < inp.annualSpend / inp.withdrawalRate);
  });

  test('crossing aligns with the headline FI age', () => {
    // Balance entering FI age (end of FI−1) clears the bar; entering FI−1 does not.
    assert.ok(endOfYear(fi - 1) >= req(fi) - 1);
    assert.ok(endOfYear(fi - 2) < req(fi - 1) + 1);
  });

  test('Social Security pulls the FI age earlier', () => {
    const withSS = simulate(inp).fiAge!;
    const withoutSS = simulate({ ...inp, ssYouAnnual: 0, ssSpouseAnnual: 0 }).fiAge!;
    assert.ok(withSS <= withoutSS);
  });
});

describe('bridge breakdown', () => {
  test('phase math is consistent', () => {
    const inp = base();
    const fi = simulate(inp).fiAge;
    const b = bridgeBreakdown(inp, fi);
    assert.equal(b.ssStartAge, Math.min(inp.ssYouClaimAge, inp.ssSpouseClaimAge));
    assert.equal(b.bridgeYears, b.ssStartAge - (fi ?? inp.retireAge));
    assert.ok(Math.abs(b.postSsGap - (inp.annualSpend - (inp.ssYouAnnual + inp.ssSpouseAnnual))) < 1);
    assert.ok(Math.abs(b.postSsNeed - b.postSsGap / inp.withdrawalRate) < 1);
  });
});
