/**
 * Persistence.
 *
 * The app talks to a `PlanRepository`, not to localStorage. The browser-backed
 * implementation is what ships today; a REST-backed one (Postgres `jsonb`
 * column, same document shape) drops in behind the same four methods with no
 * change above this file.
 */

import { parsePlan } from '../core/plan';
import { normalizePriceConfig } from '../core/pricing';
import type { LengthUnit } from '../core/units';
import type { Plan, PriceConfig } from '../core/types';

export interface PlanSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  panelCount: number;
}

export interface PlanRepository {
  list(): PlanSummary[];
  get(id: string): Plan | null;
  save(plan: Plan): void;
  remove(id: string): void;
}

const PLANS_KEY = 'arplace.panel-studio.plans.v1';
const PRICES_KEY = 'arplace.panel-studio.prices.v1';
const UNIT_KEY = 'arplace.panel-studio.unit.v1';

function readStore(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PLANS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, unknown>): void {
  try {
    localStorage.setItem(PLANS_KEY, JSON.stringify(store));
  } catch (error) {
    // Quota or private-browsing failures must not take the editor down; the
    // user still has JSON export as an escape hatch.
    console.warn('Could not persist plans locally.', error);
  }
}

export const localPlanRepository: PlanRepository = {
  list() {
    return Object.values(readStore())
      .map((raw) => {
        try {
          const plan = parsePlan(raw);
          return {
            id: plan.id,
            name: plan.name,
            version: plan.version,
            updatedAt: plan.updatedAt,
            panelCount: plan.panels.length,
          };
        } catch {
          return null;
        }
      })
      .filter((s): s is PlanSummary => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  get(id) {
    const raw = readStore()[id];
    if (!raw) return null;
    try {
      return parsePlan(raw);
    } catch {
      return null;
    }
  },

  save(plan) {
    const store = readStore();
    store[plan.id] = plan;
    writeStore(store);
  },

  remove(id) {
    const store = readStore();
    delete store[id];
    writeStore(store);
  },
};

export function loadPriceConfig(): PriceConfig {
  try {
    const raw = localStorage.getItem(PRICES_KEY);
    return normalizePriceConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizePriceConfig(null);
  }
}

export function savePriceConfig(config: PriceConfig): void {
  try {
    localStorage.setItem(PRICES_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('Could not persist the price schedule locally.', error);
  }
}

/**
 * The unit the reader wants, remembered per browser.
 *
 * Deliberately *not* stored in the plan: it is a preference of whoever is
 * looking, not a property of the building. A plan sent to a colleague who
 * works in metres opens in metres for them and in feet for its author, and no
 * plan schema had to change to allow that.
 */
export function loadUnit(): LengthUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === 'm' ? 'm' : 'ft';
  } catch {
    return 'ft';
  }
}

export function saveUnit(unit: LengthUnit): void {
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch (error) {
    console.warn('Could not remember the unit preference locally.', error);
  }
}
