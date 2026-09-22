import { describe, expect, it } from 'vitest';
import { bestTileFootprint, nearestTileableDepthFt, tileFootprint } from '../areaTiling';
import { interiorCells } from '../footprint';
import { panelCells } from '../panels';
import { tileRun } from '../tiling';
import { ftToUnits } from '../units';
import type { Panel } from '../types';

function run(xFt: number, yFt: number, lengthFt: number, orientation: 'h' | 'v'): Panel[] {
  return tileRun(ftToUnits(xFt), ftToUnits(yFt), ftToUnits(lengthFt), orientation)!;
}

function closedRoom(widthFt: number, heightFt: number, xFt = 0, yFt = 0): Panel[] {
  return [
    ...run(xFt, yFt, widthFt, 'h'),
    ...run(xFt, yFt + heightFt, widthFt, 'h'),
    ...run(xFt, yFt, heightFt, 'v'),
    ...run(xFt + widthFt, yFt, heightFt, 'v'),
  ];
}

const footprintOf = (panels: Panel[]) => interiorCells(panels);

/** Every cell the tiling's panels claim, as keys, to check for overlap. */
function claimed(panels: Panel[]): string[] {
  return panels.flatMap((p) => panelCells(p).map((c) => `${c.x},${c.y}`));
}

describe('tileFootprint', () => {
  it('covers a 20 x 20 ft room exactly with two 10 ft strips', () => {
    // 20 ft deep = two 10 ft strips; 20 ft along = five 4 ft panels each.
    const result = tileFootprint(footprintOf(closedRoom(20, 20)), 'floor', 'h');

    expect(result.uncovered).toHaveLength(0);
    expect(result.panels).toHaveLength(10);
    expect(result.panels.every((p) => p.size === '4x10')).toBe(true);
  });

  it('never claims a cell twice', () => {
    const result = tileFootprint(footprintOf(closedRoom(20, 20)), 'floor', 'h');
    const keys = claimed(result.panels);
    expect(new Set(keys).size).toBe(keys.length);
    // 20 x 20 ft = 10 x 10 grid units = 100 cells.
    expect(keys).toHaveLength(100);
  });

  it('uses a 2 ft panel for a remainder along the strip', () => {
    // 18 ft along -> four 4 ft plus one 2 ft, per strip.
    const result = tileFootprint(footprintOf(closedRoom(18, 20)), 'floor', 'h');
    expect(result.uncovered).toHaveLength(0);
    expect(result.panels.filter((p) => p.size === '2x10')).toHaveLength(2);
    expect(result.panels.filter((p) => p.size === '4x10')).toHaveLength(8);
  });

  it('reports the band a 10 ft panel cannot reach rather than approximating', () => {
    // 16 ft deep is one 10 ft strip plus a 6 ft remainder that cannot be tiled.
    const result = tileFootprint(footprintOf(closedRoom(20, 16)), 'floor', 'h');

    expect(result.panels).toHaveLength(5); // one full strip
    // 10 wide x 3 deep grid units left over = 30 cells = 120 sq ft.
    expect(result.uncovered).toHaveLength(30);
    expect(result.uncoveredSqFt).toBe(120);
  });

  it('tiles a building offset from the origin just as well', () => {
    const atOrigin = tileFootprint(footprintOf(closedRoom(20, 20)), 'floor', 'h');
    const offset = tileFootprint(footprintOf(closedRoom(20, 20, 14, 6)), 'floor', 'h');
    expect(offset.panels).toHaveLength(atOrigin.panels.length);
    expect(offset.uncovered).toHaveLength(0);
  });

  it('carries the requested category', () => {
    const result = tileFootprint(footprintOf(closedRoom(20, 20)), 'roof', 'h');
    expect(result.panels.every((p) => p.category === 'roof')).toBe(true);
  });

  it('tiles vertically when asked', () => {
    const result = tileFootprint(footprintOf(closedRoom(20, 20)), 'floor', 'v');
    expect(result.uncovered).toHaveLength(0);
    expect(result.panels.every((p) => p.orientation === 'v')).toBe(true);
  });

  it('returns nothing for an empty footprint', () => {
    const result = tileFootprint(footprintOf([]), 'floor', 'h');
    expect(result.panels).toEqual([]);
    expect(result.uncovered).toEqual([]);
  });

  it('skips a strip that is too shallow entirely', () => {
    // 6 ft deep is less than one 10 ft panel: nothing can be laid, and all
    // 10 x 3 grid units of the footprint come back uncovered.
    const result = tileFootprint(footprintOf(closedRoom(20, 6)), 'floor', 'h');
    expect(result.panels).toEqual([]);
    expect(result.uncovered).toHaveLength(30);
    expect(result.uncoveredSqFt).toBe(120);
  });

  it('tiles only the full-depth part of an L-shape', () => {
    // 20 ft wide top band 10 ft deep, then a 10 ft wide leg 10 ft deeper.
    const l = [
      ...run(0, 0, 20, 'h'),
      ...run(20, 0, 10, 'v'),
      ...run(10, 10, 10, 'h'),
      ...run(10, 10, 10, 'v'),
      ...run(0, 20, 10, 'h'),
      ...run(0, 0, 20, 'v'),
    ];
    const result = tileFootprint(footprintOf(l), 'floor', 'h');
    // Both bands tile: the first full width, the second only the left leg.
    expect(result.uncovered).toHaveLength(0);
    expect(result.panels).toHaveLength(5 + 3); // 20 ft of panels, then 10 ft
  });
});

describe('bestTileFootprint', () => {
  it('picks the strip direction that covers more', () => {
    // 20 x 16 ft: strips 10 ft deep fit across the 20 ft axis but not the
    // 16 ft one, so the solver must choose the direction that works.
    const result = bestTileFootprint(footprintOf(closedRoom(20, 16)), 'floor');
    expect(result.orientation).toBe('v');
    expect(result.uncovered).toHaveLength(0);
  });

  it('leaves a genuinely untileable footprint uncovered in both directions', () => {
    // 16 x 16 ft: neither axis is a multiple of 10 ft.
    const result = bestTileFootprint(footprintOf(closedRoom(16, 16)), 'floor');
    expect(result.uncovered.length).toBeGreaterThan(0);
  });
});

describe('nearestTileableDepthFt', () => {
  it('suggests the 10 ft multiples either side', () => {
    expect(nearestTileableDepthFt(16)).toEqual({ down: 10, up: 20 });
    expect(nearestTileableDepthFt(20)).toEqual({ down: 20, up: 20 });
  });

  it('never suggests a zero-depth building', () => {
    expect(nearestTileableDepthFt(4)).toEqual({ down: 10, up: 10 });
  });
});
