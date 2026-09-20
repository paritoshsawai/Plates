import { describe, expect, it } from 'vitest';
import { footprintAreaSqFt, interiorCells } from '../footprint';
import { tileRun } from '../tiling';
import { ftToUnits } from '../units';
import type { Panel, PanelCategory } from '../types';

function run(
  xFt: number,
  yFt: number,
  lengthFt: number,
  orientation: 'h' | 'v',
  category: PanelCategory = 'wall',
): Panel[] {
  return tileRun(ftToUnits(xFt), ftToUnits(yFt), ftToUnits(lengthFt), orientation, category)!;
}

function closedRoom(widthFt: number, heightFt: number, xFt = 0, yFt = 0): Panel[] {
  return [
    ...run(xFt, yFt, widthFt, 'h'),
    ...run(xFt, yFt + heightFt, widthFt, 'h'),
    ...run(xFt, yFt, heightFt, 'v'),
    ...run(xFt + widthFt, yFt, heightFt, 'v'),
  ];
}

describe('interiorCells', () => {
  it('finds the cells a closed room encloses', () => {
    // 20 x 16 ft = 10 x 8 grid units = 80 cells = 320 sq ft.
    const footprint = interiorCells(closedRoom(20, 16));
    expect(footprint.cells).toHaveLength(80);
    expect(footprintAreaSqFt(footprint)).toBe(320);
  });

  it('places the interior inside the walls, not on them', () => {
    const footprint = interiorCells(closedRoom(20, 16));
    expect(footprint.bounds).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 7 });
    expect(footprint.has({ x: 0, y: 0 })).toBe(true);
    expect(footprint.has({ x: 9, y: 7 })).toBe(true);
    expect(footprint.has({ x: 10, y: 0 })).toBe(false);
    expect(footprint.has({ x: -1, y: 0 })).toBe(false);
  });

  it('works for a building offset from the origin', () => {
    const footprint = interiorCells(closedRoom(20, 16, 10, 6));
    expect(footprint.cells).toHaveLength(80);
    expect(footprint.bounds).toEqual({ minX: 5, minY: 3, maxX: 14, maxY: 10 });
  });

  it('ignores interior partitions, which divide rooms but not the building', () => {
    const withPartition = [...closedRoom(20, 16), ...run(8, 0, 16, 'v')];
    expect(interiorCells(withPartition).cells).toHaveLength(80);
  });

  it('handles an L-shaped building', () => {
    // An L: 20 x 16 with the bottom-right 10 x 8 ft quadrant cut away.
    const l = [
      ...run(0, 0, 20, 'h'),
      ...run(20, 0, 8, 'v'),
      ...run(10, 8, 10, 'h'),
      ...run(10, 8, 8, 'v'),
      ...run(0, 16, 10, 'h'),
      ...run(0, 0, 16, 'v'),
    ];
    // 80 cells minus the 5 x 4 = 20-cell notch.
    const footprint = interiorCells(l);
    expect(footprint.cells).toHaveLength(60);
    // In the full-width top band.
    expect(footprint.has({ x: 7, y: 2 })).toBe(true);
    // In the narrow lower leg.
    expect(footprint.has({ x: 2, y: 6 })).toBe(true);
    // In the notch that was cut away.
    expect(footprint.has({ x: 7, y: 6 })).toBe(false);
  });

  it('encloses nothing when the walls have a hole in them', () => {
    // Drop one panel: the fill leaks in and nothing is enclosed.
    const leaky = closedRoom(20, 16).slice(1);
    expect(interiorCells(leaky).cells).toHaveLength(0);
  });

  it('encloses nothing for a lone stub wall', () => {
    expect(interiorCells(run(0, 0, 8, 'h')).cells).toHaveLength(0);
  });

  it('returns an empty footprint when there are no walls at all', () => {
    expect(interiorCells([]).cells).toEqual([]);
    expect(interiorCells([]).bounds).toBeNull();
  });

  it('does not treat an existing floor as a barrier', () => {
    // Filling a floor twice must not shrink the footprint.
    const withFloor: Panel[] = [
      ...closedRoom(20, 16),
      { id: 'f', category: 'floor', size: '4x10', x: 0, y: 0, orientation: 'h' },
    ];
    expect(interiorCells(withFloor).cells).toHaveLength(80);
  });
});
