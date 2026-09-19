/**
 * Plan documents: creation, serialisation and versioning.
 *
 * A plan is plain JSON so it round-trips through localStorage today and a
 * Postgres `jsonb` column tomorrow without a format change.
 */

import { isKnownPanelType } from './panels';
import { rectPlotFromFt } from './plot';
import type { Orientation, Panel, Plan, Plot } from './types';

export const PLAN_SCHEMA_VERSION = 1;

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function createPlan(name: string, plot?: Plot): Plan {
  const now = new Date().toISOString();
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    id: newId('plan'),
    name,
    plot: plot ?? rectPlotFromFt(60, 40),
    panels: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    notes: '',
  };
}

export function serializePlan(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

class PlanParseError extends Error {}

function asOrientation(value: unknown): Orientation {
  if (value === 'h' || value === 'v') return value;
  // Tolerate the rotation form used in exports from other tools.
  if (value === 0 || value === '0') return 'h';
  if (value === 90 || value === '90') return 'v';
  throw new PlanParseError(`Invalid panel orientation: ${String(value)}`);
}

function asInt(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) throw new PlanParseError(`${field} must be an integer grid unit`);
  return n;
}

/**
 * Parse untrusted JSON into a Plan. Throws with a readable message rather than
 * letting a malformed import become a silently broken plan - the geometry
 * invariants downstream all assume integer grid coordinates.
 */
export function deserializePlan(json: string): Plan {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new PlanParseError('File is not valid JSON.');
  }
  return parsePlan(raw);
}

export function parsePlan(raw: unknown): Plan {
  if (typeof raw !== 'object' || raw === null) throw new PlanParseError('Plan must be an object.');
  const obj = raw as Record<string, unknown>;

  const schemaVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1;
  if (schemaVersion > PLAN_SCHEMA_VERSION) {
    throw new PlanParseError(
      `Plan was saved by a newer version of Panel Studio (schema ${schemaVersion}).`,
    );
  }

  const plotRaw = obj.plot as { vertices?: unknown } | undefined;
  const verticesRaw = Array.isArray(plotRaw?.vertices) ? plotRaw.vertices : null;
  if (!verticesRaw || verticesRaw.length < 3) {
    throw new PlanParseError('Plan is missing a plot boundary with at least 3 vertices.');
  }
  const plot: Plot = {
    vertices: verticesRaw.map((v, i) => {
      const vertex = v as Record<string, unknown>;
      return {
        x: asInt(vertex.x, `plot.vertices[${i}].x`),
        y: asInt(vertex.y, `plot.vertices[${i}].y`),
      };
    }),
  };

  const panelsRaw = Array.isArray(obj.panels) ? obj.panels : [];
  const seenIds = new Set<string>();
  const panels: Panel[] = panelsRaw.map((p, i) => {
    const panel = p as Record<string, unknown>;
    const type = String(panel.type);
    if (!isKnownPanelType(type)) {
      throw new PlanParseError(`panels[${i}] has unsupported type "${type}".`);
    }
    const id = typeof panel.id === 'string' && panel.id ? panel.id : newId('p');
    if (seenIds.has(id)) throw new PlanParseError(`Duplicate panel id "${id}".`);
    seenIds.add(id);
    return {
      id,
      type,
      x: asInt(panel.x, `panels[${i}].x`),
      y: asInt(panel.y, `panels[${i}].y`),
      orientation: asOrientation(panel.orientation ?? panel.rotation),
    };
  });

  const now = new Date().toISOString();
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    id: typeof obj.id === 'string' && obj.id ? obj.id : newId('plan'),
    name: typeof obj.name === 'string' && obj.name ? obj.name : 'Imported plan',
    plot,
    panels,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now,
    version: typeof obj.version === 'number' ? obj.version : 1,
    notes: typeof obj.notes === 'string' ? obj.notes : '',
  };
}

export { PlanParseError };
