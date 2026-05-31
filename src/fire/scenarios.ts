// Scenario persistence. Everything lives in localStorage on the user's own
// machine — nothing is ever sent anywhere or committed. JSON export/import lets
// a setup move between devices without putting real figures in the repo.

import type { FireInputs } from './model';

const SCENARIOS_KEY = 'fire:scenarios';
const CURRENT_KEY = 'fire:current';

export type ScenarioMap = Record<string, FireInputs>;

const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota / private-mode errors; the app still works in-memory.
  }
};

export const loadScenarios = (): ScenarioMap => read<ScenarioMap>(SCENARIOS_KEY) ?? {};

export const saveScenario = (name: string, inputs: FireInputs): ScenarioMap => {
  const all = loadScenarios();
  all[name] = inputs;
  write(SCENARIOS_KEY, all);
  return all;
};

export const deleteScenario = (name: string): ScenarioMap => {
  const all = loadScenarios();
  delete all[name];
  write(SCENARIOS_KEY, all);
  return all;
};

export const loadCurrent = (): FireInputs | null => read<FireInputs>(CURRENT_KEY);

export const saveCurrent = (inputs: FireInputs): void => write(CURRENT_KEY, inputs);

/** Serialize the named scenarios (plus current) to a downloadable JSON blob. */
export const exportJson = (current: FireInputs): string =>
  JSON.stringify({ current, scenarios: loadScenarios() }, null, 2);

export interface ImportResult {
  current: FireInputs | null;
  scenarios: ScenarioMap;
}

/** Parse an exported JSON string and persist it. Throws on malformed input. */
export const importJson = (raw: string): ImportResult => {
  const parsed = JSON.parse(raw) as ImportResult;
  if (parsed.scenarios) write(SCENARIOS_KEY, parsed.scenarios);
  if (parsed.current) write(CURRENT_KEY, parsed.current);
  return { current: parsed.current ?? null, scenarios: parsed.scenarios ?? {} };
};
