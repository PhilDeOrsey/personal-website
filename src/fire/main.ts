import './fire.css';
import {
  bridgeBreakdown,
  defaultInputs,
  requiredPortfolioCurve,
  simulate,
  type FireInputs,
  type Projection,
} from './model';
import { renderControls } from './controls';
import { renderChart, type Series } from './chart';
import { money, percent, years } from './format';
import {
  deleteScenario,
  exportJson,
  importJson,
  loadCurrent,
  loadScenarios,
  saveCurrent,
  saveScenario,
} from './scenarios';

// Distinct colors for the active projection + compared scenarios.
const PALETTE = ['#1f4ed8', '#d8431f', '#1f9d55', '#9d1f8a', '#b8860b', '#0d9488'];
const FI_COLOR = '#9a9a9a';
const REQUIRED_COLOR = '#b8860b';

// ---- Chart-overlay toggles (persisted) ----
type OverlayKey = 'naive25x' | 'requiredCurve' | 'bridge';
const OVERLAY_KEY = 'fire:overlays';
const OVERLAY_DEFS: { key: OverlayKey; label: string }[] = [
  { key: 'naive25x', label: '25× spend (no SS)' },
  { key: 'requiredCurve', label: 'Required portfolio (SS-aware)' },
  { key: 'bridge', label: 'Bridge breakdown' },
];
const defaultOverlays = (): Record<OverlayKey, boolean> => ({
  naive25x: true,
  requiredCurve: false,
  bridge: false,
});
const loadOverlays = (): Record<OverlayKey, boolean> => {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (raw) return { ...defaultOverlays(), ...(JSON.parse(raw) as Record<OverlayKey, boolean>) };
  } catch {
    /* ignore */
  }
  return defaultOverlays();
};
const overlays = loadOverlays();
const saveOverlays = (): void => {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlays));
  } catch {
    /* ignore */
  }
};

const currentYear = (): number => new Date().getFullYear();

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
};

const clone = (i: FireInputs): FireInputs => JSON.parse(JSON.stringify(i)) as FireInputs;

// Backfill any keys missing from older saved state (e.g. before the cash bucket
// existed) so the engine never sees an undefined field.
const withDefaults = (i: FireInputs): FireInputs => ({ ...defaultInputs(currentYear()), ...i });

let inputs: FireInputs = withDefaults(loadCurrent() ?? defaultInputs(currentYear()));
// Names of saved scenarios currently overlaid for comparison.
let compareNames: string[] = [];

const netWorthSeries = (proj: Projection, label: string, color: string): Series => ({
  label,
  color,
  points: proj.rows.map((r) => ({ x: r.yourAge, y: r.total })),
});

const stat = (k: string, v: string): string =>
  `<div class="stat"><span class="stat-k">${k}</span><span class="stat-v">${v}</span></div>`;

const renderStats = (proj: Projection, extra: string): void => {
  const fi = proj.fiAge !== null ? `${proj.fiAge} (${years(proj.fiAge - inputs.yourAge)})` : 'not reached';
  const retire =
    inputs.retireMode === 'earliest'
      ? `${proj.retireAge} (earliest)`
      : `${proj.retireAge} (fixed)`;
  const outcome = proj.depletionAge !== null
    ? `<span class="bad">depletes at ${proj.depletionAge}</span>`
    : `<span class="good">funded through ${inputs.horizonAge}</span>`;

  $('#stats').innerHTML =
    stat('FI age', fi) +
    stat('Retire age', retire) +
    stat('Portfolio at retirement', money(proj.portfolioAtRetirement)) +
    stat('Real return', percent(proj.realReturn)) +
    stat('Outcome', outcome) +
    stat('Ending balance', money(proj.endingBalance)) +
    extra;
};

const renderOverlayToggles = (): void => {
  $('#overlay-toggles').innerHTML =
    `<span class="ovl-label">Show:</span>` +
    OVERLAY_DEFS.map(
      (d) =>
        `<label class="ovl"><input type="checkbox" data-ovl="${d.key}"${
          overlays[d.key] ? ' checked' : ''
        } /> ${d.label}</label>`,
    ).join('');
  $('#overlay-toggles')
    .querySelectorAll<HTMLInputElement>('[data-ovl]')
    .forEach((cb) =>
      cb.addEventListener('change', () => {
        overlays[cb.dataset.ovl as OverlayKey] = cb.checked;
        saveOverlays();
        recompute();
      }),
    );
};

const renderBridge = (proj: Projection): void => {
  const el = $('#bridge-panel');
  if (!overlays.bridge) {
    el.innerHTML = '';
    return;
  }
  const b = bridgeBreakdown(inputs, proj.fiAge);
  const from = b.fiAge ?? proj.retireAge;
  el.innerHTML = `<div class="bridge">
    <h3>Bridge to Social Security</h3>
    <div class="bridge-phases">
      <div class="phase">
        <div class="phase-h">Phase 1 · Bridge (${b.bridgeYears} yrs)</div>
        <p>Age <strong>${from}</strong> → <strong>${b.ssStartAge}</strong>: the portfolio funds the full
        <strong>${money(b.spendDuringBridge)}/yr</strong> — no Social Security yet.</p>
      </div>
      <div class="phase">
        <div class="phase-h">Phase 2 · After SS (age ${b.ssStartAge}+)</div>
        <p><strong>${money(b.totalSS)}/yr</strong> in Social Security covers most of spend. The remaining gap is
        <strong>${money(b.postSsGap)}/yr</strong> — about <strong>${money(b.postSsNeed)}</strong> of portfolio at a
        ${percent(inputs.withdrawalRate, 0)} draw.</p>
      </div>
    </div>
  </div>`;
};

const recompute = (): void => {
  saveCurrent(inputs);
  const proj = simulate(inputs);

  const series: Series[] = [netWorthSeries(proj, 'Current', PALETTE[0])];
  let extraStats = '';

  if (overlays.naive25x) {
    series.push({
      label: '25× spend (no SS)',
      color: FI_COLOR,
      dashed: true,
      points: proj.rows.map((r) => ({ x: r.yourAge, y: r.fiNumber })),
    });
    extraStats += stat('25× spend (no SS)', money(inputs.annualSpend / inputs.withdrawalRate));
  }

  if (overlays.requiredCurve) {
    const curve = requiredPortfolioCurve(inputs, proj.rows);
    series.push({
      label: 'Required (SS-aware)',
      color: REQUIRED_COLOR,
      dashed: true,
      points: curve.map((p) => ({ x: p.age, y: p.required })),
    });
    const atFi = proj.fiAge !== null ? curve.find((p) => p.age === proj.fiAge)?.required : undefined;
    extraStats += stat('FI number (SS-aware)', atFi !== undefined ? money(atFi) : '—');
  }

  renderStats(proj, extraStats);
  renderBridge(proj);

  const saved = loadScenarios();
  compareNames.forEach((name, i) => {
    const s = saved[name];
    if (!s) return;
    series.push(netWorthSeries(simulate(withDefaults(s)), name, PALETTE[(i + 1) % PALETTE.length]));
  });

  renderChart($('#chart'), series, { xLabel: 'Your age' });
};

// ---- Scenario bar ----------------------------------------------------------

const renderScenarioBar = (): void => {
  const saved = loadScenarios();
  const names = Object.keys(saved).sort();
  const compareBoxes = names
    .map(
      (n) =>
        `<label class="cmp"><input type="checkbox" data-cmp="${n}"${
          compareNames.includes(n) ? ' checked' : ''
        } /> ${n}</label>`,
    )
    .join('');

  $('#scenario-bar').innerHTML = `
    <div class="scn-row">
      <input id="scn-name" type="text" placeholder="scenario name" />
      <button id="scn-save" type="button">Save</button>
      <button id="scn-export" type="button">Export JSON</button>
      <label id="scn-import-label" class="btn-like">Import JSON<input id="scn-import" type="file" accept="application/json" hidden /></label>
    </div>
    ${names.length ? `<div class="scn-compare"><span class="muted">Compare:</span>${compareBoxes}</div>` : ''}
    <div id="scn-list" class="scn-list">${names
      .map(
        (n) =>
          `<span class="scn-chip"><button type="button" data-load="${n}">${n}</button><button type="button" class="chip-x" data-del="${n}" aria-label="Delete ${n}">✕</button></span>`,
      )
      .join('')}</div>`;

  wireScenarioBar();
};

const wireScenarioBar = (): void => {
  $('#scn-save').addEventListener('click', () => {
    const name = $<HTMLInputElement>('#scn-name').value.trim();
    if (!name) return;
    saveScenario(name, clone(inputs));
    renderScenarioBar();
  });

  $('#scn-export').addEventListener('click', () => {
    const blob = new Blob([exportJson(inputs)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fire-scenarios.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $<HTMLInputElement>('#scn-import').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importJson(String(reader.result));
        if (result.current) inputs = withDefaults(result.current);
        compareNames = [];
        rerenderAll();
      } catch {
        alert('Could not parse that JSON file.');
      }
    };
    reader.readAsText(file);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((b) =>
    b.addEventListener('click', () => {
      const saved = loadScenarios();
      const s = saved[b.dataset.load!];
      if (!s) return;
      inputs = withDefaults(clone(s));
      rerenderAll();
    }),
  );

  document.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const name = b.dataset.del!;
      deleteScenario(name);
      compareNames = compareNames.filter((n) => n !== name);
      renderScenarioBar();
      recompute();
    }),
  );

  document.querySelectorAll<HTMLInputElement>('[data-cmp]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const name = cb.dataset.cmp!;
      compareNames = cb.checked
        ? [...compareNames, name]
        : compareNames.filter((n) => n !== name);
      recompute();
    }),
  );
};

// Full re-render after a structural change (load/import).
const rerenderAll = (): void => {
  renderControls($('#controls'), inputs, recompute);
  renderOverlayToggles();
  renderScenarioBar();
  recompute();
};

/**
 * In local dev only, seed from a gitignored `fire/my-data.local.json` (the
 * shape produced by the Export button). The file is never committed
 * (.gitignore: *.local.json) and never shipped (not a build input / not in
 * public/), so real figures stay on your machine. Production builds skip this.
 *
 * We seed whenever the file's contents differ from what we last loaded (tracked
 * in `fire:seed-source`). That means editing the file re-seeds on reload, while
 * edits you make in the browser persist as long as the file is unchanged.
 */
const SEED_KEY = 'fire:seed-source';

const init = async (): Promise<void> => {
  if (import.meta.env.DEV) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}fire/my-data.local.json`);
      if (res.ok) {
        const text = await res.text();
        if (text !== localStorage.getItem(SEED_KEY)) {
          const result = importJson(text);
          if (result.current) inputs = withDefaults(result.current);
          localStorage.setItem(SEED_KEY, text);
        }
      }
    } catch {
      // No local seed file — keep whatever was loaded. Expected on a fresh clone.
    }
  }
  rerenderAll();
};

void init();
