// Renders the grouped input controls (synced slider + number box per variable)
// and notifies a callback whenever any value changes.

import type { FireInputs, IncomeEvent } from './model';
import { money, percent } from './format';

type Kind = 'money' | 'percent' | 'age' | 'count' | 'plain';

interface NumberField {
  type: 'number';
  group: string;
  label: string;
  kind: Kind;
  min: number;
  max: number;
  step: number;
  get: (i: FireInputs) => number;
  set: (i: FireInputs, v: number) => void;
}

interface SelectField {
  type: 'select';
  group: string;
  label: string;
  options: { value: string; label: string }[];
  get: (i: FireInputs) => string;
  set: (i: FireInputs, v: string) => void;
}

type Field = NumberField | SelectField;

const GROUPS = [
  'Household',
  'Accounts',
  'Contributions',
  'Income',
  'Expenses',
  'Market',
  'Social Security',
  'Taxes',
  'Retirement',
] as const;

const num = (
  group: string,
  label: string,
  kind: Kind,
  min: number,
  max: number,
  step: number,
  get: (i: FireInputs) => number,
  set: (i: FireInputs, v: number) => void,
): NumberField => ({ type: 'number', group, label, kind, min, max, step, get, set });

const FIELDS: Field[] = [
  // Household
  num('Household', 'Your age', 'age', 18, 90, 1, (i) => i.yourAge, (i, v) => (i.yourAge = v)),
  num('Household', 'Spouse age', 'age', 18, 90, 1, (i) => i.spouseAge, (i, v) => (i.spouseAge = v)),
  num('Household', 'Plan to age', 'age', 70, 105, 1, (i) => i.horizonAge, (i, v) => (i.horizonAge = v)),

  // Accounts
  num('Accounts', 'Cash / HYSA balance', 'money', 0, 1_000_000, 1_000, (i) => i.cashBalance, (i, v) => (i.cashBalance = v)),
  num('Accounts', 'Taxable (brokerage)', 'money', 0, 2_000_000, 1_000, (i) => i.taxableBalance, (i, v) => (i.taxableBalance = v)),
  num('Accounts', 'Pre-tax (401k/403b/IRA)', 'money', 0, 3_000_000, 1_000, (i) => i.pretaxBalance, (i, v) => (i.pretaxBalance = v)),
  num('Accounts', 'Roth balance', 'money', 0, 2_000_000, 1_000, (i) => i.rothBalance, (i, v) => (i.rothBalance = v)),

  // Contributions
  num('Contributions', 'Cash / HYSA / yr', 'money', 0, 100_000, 500, (i) => i.cashContrib, (i, v) => (i.cashContrib = v)),
  num('Contributions', 'Cash cap (overflow → brokerage)', 'money', 0, 1_000_000, 5_000, (i) => i.cashCap, (i, v) => (i.cashCap = v)),
  num('Contributions', 'Taxable / yr', 'money', 0, 200_000, 500, (i) => i.taxableContrib, (i, v) => (i.taxableContrib = v)),
  num('Contributions', 'Pre-tax / yr', 'money', 0, 100_000, 500, (i) => i.pretaxContrib, (i, v) => (i.pretaxContrib = v)),
  num('Contributions', 'Roth / yr', 'money', 0, 50_000, 500, (i) => i.rothContrib, (i, v) => (i.rothContrib = v)),
  num('Contributions', 'Employer match / yr', 'money', 0, 50_000, 500, (i) => i.employerMatch, (i, v) => (i.employerMatch = v)),

  // Income
  num('Income', 'Your income', 'money', 0, 500_000, 1_000, (i) => i.yourIncome, (i, v) => (i.yourIncome = v)),
  num('Income', 'Spouse income', 'money', 0, 500_000, 1_000, (i) => i.spouseIncome, (i, v) => (i.spouseIncome = v)),

  // Expenses
  num('Expenses', 'Annual spend (retired)', 'money', 0, 300_000, 1_000, (i) => i.annualSpend, (i, v) => (i.annualSpend = v)),

  // Market
  num('Market', 'Investment return', 'percent', 0, 0.12, 0.0025, (i) => i.nominalReturn, (i, v) => (i.nominalReturn = v)),
  num('Market', 'Cash / HYSA return', 'percent', 0, 0.08, 0.0025, (i) => i.cashReturn, (i, v) => (i.cashReturn = v)),
  num('Market', 'Inflation', 'percent', 0, 0.08, 0.0025, (i) => i.inflation, (i, v) => (i.inflation = v)),

  // Social Security
  num('Social Security', 'Your SS / yr', 'money', 0, 80_000, 500, (i) => i.ssYouAnnual, (i, v) => (i.ssYouAnnual = v)),
  num('Social Security', 'Your claim age', 'age', 62, 70, 1, (i) => i.ssYouClaimAge, (i, v) => (i.ssYouClaimAge = v)),
  num('Social Security', 'Spouse SS / yr', 'money', 0, 80_000, 500, (i) => i.ssSpouseAnnual, (i, v) => (i.ssSpouseAnnual = v)),
  num('Social Security', 'Spouse claim age', 'age', 62, 70, 1, (i) => i.ssSpouseClaimAge, (i, v) => (i.ssSpouseClaimAge = v)),

  // Taxes
  {
    type: 'select',
    group: 'Taxes',
    label: 'Tax model',
    options: [
      { value: 'effective', label: 'Flat effective rate' },
      { value: 'brackets', label: 'Federal brackets (MFJ)' },
    ],
    get: (i) => i.taxMode,
    set: (i, v) => (i.taxMode = v as FireInputs['taxMode']),
  },
  num('Taxes', 'Effective rate', 'percent', 0, 0.4, 0.005, (i) => i.effectiveTaxRate, (i, v) => (i.effectiveTaxRate = v)),

  // Retirement
  {
    type: 'select',
    group: 'Retirement',
    label: 'Retirement mode',
    options: [
      { value: 'earliest', label: 'Find earliest FI' },
      { value: 'fixed', label: 'Fixed retire age' },
    ],
    get: (i) => i.retireMode,
    set: (i, v) => (i.retireMode = v as FireInputs['retireMode']),
  },
  num('Retirement', 'Retire age (fixed)', 'age', 30, 90, 1, (i) => i.retireAge, (i, v) => (i.retireAge = v)),
  num('Retirement', 'Withdrawal rate', 'percent', 0.02, 0.08, 0.0025, (i) => i.withdrawalRate, (i, v) => (i.withdrawalRate = v)),
];

const fmtValue = (kind: Kind, v: number): string => {
  switch (kind) {
    case 'money':
      return money(v);
    case 'percent':
      return percent(v, 2);
    case 'age':
    case 'count':
      return String(v);
    default:
      return String(v);
  }
};

export const renderControls = (
  root: HTMLElement,
  inputs: FireInputs,
  onChange: () => void,
): void => {
  const groupsHtml = GROUPS.map((g) => {
    const fields = FIELDS.filter((f) => f.group === g);
    const rows = fields
      .map((f, idx) => {
        const id = `f-${g}-${idx}`.replace(/\s+/g, '');
        if (f.type === 'select') {
          const opts = f.options
            .map(
              (o) =>
                `<option value="${o.value}"${o.value === f.get(inputs) ? ' selected' : ''}>${o.label}</option>`,
            )
            .join('');
          return `<div class="control" data-group="${g}" data-idx="${idx}">
            <label for="${id}">${f.label}</label>
            <select id="${id}" data-role="select">${opts}</select>
          </div>`;
        }
        const v = f.get(inputs);
        return `<div class="control" data-group="${g}" data-idx="${idx}">
          <label for="${id}">${f.label} <span class="control-val" data-role="val">${fmtValue(f.kind, v)}</span></label>
          <div class="control-row">
            <input type="range" id="${id}" data-role="slider" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" />
            <input type="number" data-role="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" />
          </div>
        </div>`;
      })
      .join('');
    return `<details class="control-group" open>
      <summary>${g}</summary>
      <div class="control-list">${rows}</div>
    </details>`;
  }).join('');

  root.innerHTML = `${groupsHtml}${incomeEventsHtml(inputs)}${mortgageHtml(inputs)}`;

  wire(root, inputs, onChange);
};

const mortgageHtml = (inputs: FireInputs): string => {
  const m = inputs.mortgage;
  const on = m !== null;
  return `<details class="control-group" open>
    <summary>Mortgage</summary>
    <div class="control-list">
      <div class="control">
        <label><input type="checkbox" data-role="mortgage-toggle"${on ? ' checked' : ''} /> Has a mortgage</label>
      </div>
      <div class="control" data-role="mortgage-fields" style="${on ? '' : 'display:none'}">
        <label>Annual payment <span data-role="m-pay-val">${money(m?.annualPayment ?? 0)}</span></label>
        <div class="control-row">
          <input type="range" data-role="m-pay" min="0" max="120000" step="500" value="${m?.annualPayment ?? 24000}" />
          <input type="number" data-role="m-pay-num" min="0" step="500" value="${m?.annualPayment ?? 24000}" />
        </div>
        <label>Years remaining <span data-role="m-yrs-val">${m?.yearsRemaining ?? 0}</span></label>
        <div class="control-row">
          <input type="range" data-role="m-yrs" min="0" max="40" step="1" value="${m?.yearsRemaining ?? 20}" />
          <input type="number" data-role="m-yrs-num" min="0" max="40" step="1" value="${m?.yearsRemaining ?? 20}" />
        </div>
      </div>
    </div>
  </details>`;
};

const incomeEventsHtml = (inputs: FireInputs): string => {
  const rows = inputs.incomeEvents
    .map(
      (e, i) => `<div class="event-row" data-event="${i}">
        <select data-role="ev-who">
          <option value="you"${e.who === 'you' ? ' selected' : ''}>You</option>
          <option value="spouse"${e.who === 'spouse' ? ' selected' : ''}>Spouse</option>
        </select>
        <span>at your age</span>
        <input type="number" data-role="ev-age" min="18" max="100" value="${e.atYourAge}" />
        <span>→</span>
        <input type="number" data-role="ev-amt" min="0" step="1000" value="${e.newAnnual}" />
        <button type="button" data-role="ev-del" aria-label="Remove">✕</button>
      </div>`,
    )
    .join('');
  return `<details class="control-group" open>
    <summary>Income changes</summary>
    <div class="control-list">
      <div class="event-list">${rows || '<p class="muted">No income changes.</p>'}</div>
      <button type="button" class="add-event" data-role="ev-add">+ Add income change</button>
    </div>
  </details>`;
};

const wire = (root: HTMLElement, inputs: FireInputs, onChange: () => void): void => {
  // Slider/number/select fields.
  root.querySelectorAll<HTMLElement>('.control[data-idx]').forEach((el) => {
    const g = el.dataset.group!;
    const idx = Number(el.dataset.idx);
    const field = FIELDS.filter((f) => f.group === g)[idx];
    if (!field) return;

    if (field.type === 'select') {
      const sel = el.querySelector<HTMLSelectElement>('[data-role="select"]')!;
      sel.addEventListener('change', () => {
        field.set(inputs, sel.value);
        onChange();
      });
      return;
    }

    const slider = el.querySelector<HTMLInputElement>('[data-role="slider"]')!;
    const number = el.querySelector<HTMLInputElement>('[data-role="number"]')!;
    const valEl = el.querySelector<HTMLElement>('[data-role="val"]')!;
    const apply = (raw: string, syncSlider: boolean): void => {
      const v = Number(raw);
      if (Number.isNaN(v)) return;
      field.set(inputs, v);
      valEl.textContent = fmtValue(field.kind, v);
      if (syncSlider) slider.value = String(v);
      else number.value = String(v);
      onChange();
    };
    slider.addEventListener('input', () => apply(slider.value, false));
    number.addEventListener('input', () => apply(number.value, true));
  });

  wireMortgage(root, inputs, onChange);
  wireEvents(root, inputs, onChange);
};

const wireMortgage = (root: HTMLElement, inputs: FireInputs, onChange: () => void): void => {
  const toggle = root.querySelector<HTMLInputElement>('[data-role="mortgage-toggle"]');
  const fields = root.querySelector<HTMLElement>('[data-role="mortgage-fields"]');
  if (!toggle || !fields) return;

  const ensure = (): NonNullable<FireInputs['mortgage']> => {
    if (!inputs.mortgage) inputs.mortgage = { annualPayment: 24_000, yearsRemaining: 20 };
    return inputs.mortgage;
  };

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      ensure();
      fields.style.display = '';
    } else {
      inputs.mortgage = null;
      fields.style.display = 'none';
    }
    onChange();
  });

  const pay = root.querySelector<HTMLInputElement>('[data-role="m-pay"]')!;
  const payNum = root.querySelector<HTMLInputElement>('[data-role="m-pay-num"]')!;
  const payVal = root.querySelector<HTMLElement>('[data-role="m-pay-val"]')!;
  const yrs = root.querySelector<HTMLInputElement>('[data-role="m-yrs"]')!;
  const yrsNum = root.querySelector<HTMLInputElement>('[data-role="m-yrs-num"]')!;
  const yrsVal = root.querySelector<HTMLElement>('[data-role="m-yrs-val"]')!;

  const setPay = (raw: string, syncSlider: boolean): void => {
    const v = Number(raw);
    if (Number.isNaN(v)) return;
    ensure().annualPayment = v;
    payVal.textContent = money(v);
    if (syncSlider) pay.value = String(v);
    else payNum.value = String(v);
    onChange();
  };
  const setYrs = (raw: string, syncSlider: boolean): void => {
    const v = Number(raw);
    if (Number.isNaN(v)) return;
    ensure().yearsRemaining = v;
    yrsVal.textContent = String(v);
    if (syncSlider) yrs.value = String(v);
    else yrsNum.value = String(v);
    onChange();
  };
  pay.addEventListener('input', () => setPay(pay.value, false));
  payNum.addEventListener('input', () => setPay(payNum.value, true));
  yrs.addEventListener('input', () => setYrs(yrs.value, false));
  yrsNum.addEventListener('input', () => setYrs(yrsNum.value, true));
};

const wireEvents = (root: HTMLElement, inputs: FireInputs, onChange: () => void): void => {
  const add = root.querySelector<HTMLButtonElement>('[data-role="ev-add"]');
  add?.addEventListener('click', () => {
    const last = inputs.incomeEvents[inputs.incomeEvents.length - 1];
    const event: IncomeEvent = {
      atYourAge: last ? last.atYourAge + 5 : inputs.yourAge + 5,
      who: 'you',
      newAnnual: inputs.yourIncome,
    };
    inputs.incomeEvents.push(event);
    renderControls(root, inputs, onChange);
    onChange();
  });

  root.querySelectorAll<HTMLElement>('.event-row').forEach((rowEl) => {
    const i = Number(rowEl.dataset.event);
    const who = rowEl.querySelector<HTMLSelectElement>('[data-role="ev-who"]')!;
    const age = rowEl.querySelector<HTMLInputElement>('[data-role="ev-age"]')!;
    const amt = rowEl.querySelector<HTMLInputElement>('[data-role="ev-amt"]')!;
    const del = rowEl.querySelector<HTMLButtonElement>('[data-role="ev-del"]')!;

    who.addEventListener('change', () => {
      inputs.incomeEvents[i].who = who.value as IncomeEvent['who'];
      onChange();
    });
    age.addEventListener('input', () => {
      inputs.incomeEvents[i].atYourAge = Number(age.value);
      onChange();
    });
    amt.addEventListener('input', () => {
      inputs.incomeEvents[i].newAnnual = Number(amt.value);
      onChange();
    });
    del.addEventListener('click', () => {
      inputs.incomeEvents.splice(i, 1);
      renderControls(root, inputs, onChange);
      onChange();
    });
  });
};
