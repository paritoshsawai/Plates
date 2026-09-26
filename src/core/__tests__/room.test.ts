import { describe, expect, it } from 'vitest';
import { roomRuns, straightEnd, tileRoom } from '../room';
import { buildEdgeIndex, coveredEdgeCount } from '../walls';
import { detectJunctions } from '../junctions';
import { validatePlan } from '../validation';
import { createPlan } from '../plan';
import type { Panel } from '../types';

/**
 * Rooms drawn as a rectangle.
 *
 * The property that matters is that a room drawn this way is exactly the room
 * somebody would have drawn as four separate runs - same panels, same corner
 * connectors, no doubled 2 ft anywhere. Corners are shared nodes, and a node
 * is dimensionless, so the four runs meet without overlapping.
 */

const id = (panels: Panel[]) => panels.map((p, i) => ({ ...p, id: `p${i}` }));

describe('roomRuns', () => {
  it('gives four runs around the rectangle', () => {
    expect(roomRuns({ x: 0, y: 0 }, { x: 10, y: 8 })).toHaveLength(4);
  });

  it('reads the same whichever corner you started from', () => {
    const a = roomRuns({ x: 0, y: 0 }, { x: 10, y: 8 });
    for (const [from, to] of [
      [{ x: 10, y: 8 }, { x: 0, y: 0 }],
      [{ x: 0, y: 8 }, { x: 10, y: 0 }],
      [{ x: 10, y: 0 }, { x: 0, y: 8 }],
    ] as const) {
      expect(roomRuns(from, to)).toEqual(a);
    }
  });

  it('refuses a rectangle with no width or no depth', () => {
    // Two runs laid on top of each other is not a room, it is a doubled wall.
    expect(roomRuns({ x: 0, y: 0 }, { x: 10, y: 0 })).toEqual([]);
    expect(roomRuns({ x: 0, y: 0 }, { x: 0, y: 8 })).toEqual([]);
    expect(roomRuns({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([]);
  });

  it('runs corner to corner, so the sides meet the ends at a node', () => {
    const [north, south, west, east] = roomRuns({ x: 2, y: 3 }, { x: 8, y: 9 });
    expect(north).toEqual({ from: { x: 2, y: 3 }, to: { x: 8, y: 3 } });
    expect(south).toEqual({ from: { x: 2, y: 9 }, to: { x: 8, y: 9 } });
    expect(west).toEqual({ from: { x: 2, y: 3 }, to: { x: 2, y: 9 } });
    expect(east).toEqual({ from: { x: 8, y: 3 }, to: { x: 8, y: 9 } });
  });
});

describe('tileRoom', () => {
  it('covers every 2 ft of the perimeter exactly once', () => {
    // 10 x 8 units is a 20 x 16 ft room: perimeter 2*(10+8) = 36 units.
    const panels = id(tileRoom({ x: 0, y: 0 }, { x: 10, y: 8 })!);
    expect(coveredEdgeCount(buildEdgeIndex(panels))).toBe(36);
  });

  it('never claims the same 2 ft twice, which is what a doubled corner is', () => {
    const panels = id(tileRoom({ x: 0, y: 0 }, { x: 10, y: 8 })!);
    const issues = validatePlan(panels, createPlan('t').plot).issues;
    expect(issues.filter((i) => i.code === 'overlap')).toEqual([]);
  });

  it('closes, so no wall has an open end', () => {
    const panels = id(tileRoom({ x: 0, y: 0 }, { x: 10, y: 8 })!);
    const issues = validatePlan(panels, createPlan('t').plot).issues;
    expect(issues.filter((i) => i.code === 'open-end')).toEqual([]);
  });

  it('produces exactly four corner connectors and nothing else', () => {
    const panels = id(tileRoom({ x: 0, y: 0 }, { x: 10, y: 8 })!);
    const junctions = detectJunctions(panels);
    expect(junctions).toHaveLength(4);
    expect(junctions.every((j) => j.type === 'corner')).toBe(true);
  });

  it('is the fewest panels the four runs can be built from', () => {
    // 10 units = 20 ft = five 4 ft panels; 8 units = 16 ft = four. Twice each.
    const panels = tileRoom({ x: 0, y: 0 }, { x: 10, y: 8 })!;
    expect(panels).toHaveLength(2 * 5 + 2 * 4);
    expect(panels.every((p) => p.size === '4x10')).toBe(true);
  });

  it('uses a 2 ft panel where a run needs one', () => {
    // 7 units = 14 ft = three 4 ft panels and one 2 ft.
    const panels = tileRoom({ x: 0, y: 0 }, { x: 7, y: 7 })!;
    expect(panels.filter((p) => p.size === '2x10')).toHaveLength(4);
  });

  it('builds in the category being drawn', () => {
    const panels = tileRoom({ x: 0, y: 0 }, { x: 4, y: 4 }, 'wall')!;
    expect(panels.every((p) => p.category === 'wall')).toBe(true);
  });

  it('returns null rather than half a room when the rectangle is degenerate', () => {
    expect(tileRoom({ x: 0, y: 0 }, { x: 6, y: 0 })).toBeNull();
    expect(tileRoom({ x: 3, y: 3 }, { x: 3, y: 3 })).toBeNull();
  });

  it('works from any corner, for the same panels', () => {
    const count = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      tileRoom(a, b)!.length;
    expect(count({ x: 9, y: 7 }, { x: 1, y: 1 })).toBe(count({ x: 1, y: 1 }, { x: 9, y: 7 }));
  });
});

describe('straightEnd', () => {
  it('keeps a run on the axis it travelled further along', () => {
    expect(straightEnd({ x: 0, y: 0 }, { x: 6, y: 2 })).toEqual({ x: 6, y: 0 });
    expect(straightEnd({ x: 0, y: 0 }, { x: 2, y: 6 })).toEqual({ x: 0, y: 6 });
  });

  it('prefers horizontal on a perfect diagonal, so the result is never ambiguous', () => {
    expect(straightEnd({ x: 0, y: 0 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 0 });
  });

  it('handles negative directions', () => {
    expect(straightEnd({ x: 10, y: 10 }, { x: 4, y: 8 })).toEqual({ x: 4, y: 10 });
    expect(straightEnd({ x: 10, y: 10 }, { x: 8, y: 4 })).toEqual({ x: 10, y: 4 });
  });

  it('collapses to the start when the cursor has not moved', () => {
    expect(straightEnd({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });
});
