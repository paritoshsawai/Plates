import { describe, expect, it } from 'vitest';
import { countJunctions, detectJunctions } from '../junctions';
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

function closedRoom(widthFt: number, heightFt: number, category: PanelCategory = 'wall'): Panel[] {
  return [
    ...run(0, 0, widthFt, 'h', category),
    ...run(0, heightFt, widthFt, 'h', category),
    ...run(0, 0, heightFt, 'v', category),
    ...run(widthFt, 0, heightFt, 'v', category),
  ];
}

describe('detectJunctions', () => {
  it('finds exactly four corners on a closed rectangle', () => {
    expect(countJunctions(closedRoom(20, 16))).toEqual({
      corner: 4,
      't-junction': 0,
      cross: 0,
    });
  });

  it('puts the corners at the room corners', () => {
    const corners = detectJunctions(closedRoom(20, 16)).map((j) => [j.at.x, j.at.y]);
    // Grid units: 20 ft = 10 units across, 16 ft = 8 down.
    expect(corners).toEqual([
      [0, 0],
      [10, 0],
      [0, 8],
      [10, 8],
    ]);
  });

  it('needs no connector where a wall simply carries on straight', () => {
    // One 20 ft run is five panels meeting at four interior nodes, none of
    // which is a junction - degree 2 on a single axis is a continuation.
    expect(countJunctions(run(0, 0, 20, 'h'))).toEqual({
      corner: 0,
      't-junction': 0,
      cross: 0,
    });
  });

  it('needs no connector at a dangling wall end', () => {
    // A degree-1 node is an open end, which validation reports as an error
    // rather than something to buy hardware for.
    const junctions = detectJunctions(run(0, 0, 4, 'h'));
    expect(junctions).toEqual([]);
  });

  it('counts a T where an interior partition lands on a wall', () => {
    // A partition dropped from the top wall of a 20 x 16 room at x = 8 ft.
    const panels = [...closedRoom(20, 16), ...run(8, 0, 16, 'v')];
    expect(countJunctions(panels)).toEqual({
      corner: 4,
      't-junction': 2,
      cross: 0,
    });
  });

  it('counts a cross where two partitions meet inside the room', () => {
    const panels = [
      ...closedRoom(20, 16),
      ...run(8, 0, 16, 'v'),
      ...run(0, 8, 20, 'h'),
    ];
    // The two partitions cross at (8 ft, 8 ft); each also Ts into two walls.
    expect(countJunctions(panels)).toEqual({
      corner: 4,
      't-junction': 4,
      cross: 1,
    });
  });

  it('ignores area categories, which create no wall junction', () => {
    // A roof laid over the same rectangle must not double the corner count.
    const panels = [...closedRoom(20, 16, 'wall'), ...closedRoom(20, 16, 'roof')];
    expect(countJunctions(panels)).toEqual({
      corner: 4,
      't-junction': 0,
      cross: 0,
    });
  });

  it('counts doors and windows as wall line, since they still meet at corners', () => {
    const panels = closedRoom(20, 16).map((panel, i) =>
      i === 0 ? { ...panel, category: 'door' as const } : panel,
    );
    expect(countJunctions(panels).corner).toBe(4);
  });

  it('returns nothing for an empty plan', () => {
    expect(detectJunctions([])).toEqual([]);
  });

  it('attributes each junction to the panels meeting there', () => {
    const junction = detectJunctions(closedRoom(20, 16))[0];
    expect(junction.panelIds.length).toBeGreaterThanOrEqual(2);
  });
});
