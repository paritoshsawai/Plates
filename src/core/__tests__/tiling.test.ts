import { describe, expect, it } from 'vitest';
import {
  CATALOG_GREEDY_IS_OPTIMAL,
  greedyIsOptimalUpTo,
  greedyTiling,
  minPanelCount,
  minPanelTiling,
  minPanelTilingDP,
  tileRun,
  tilingSequence,
} from '../tiling';
import { DENOMINATIONS_UNITS } from '../panels';
import { ftToUnits } from '../units';

describe('denominations', () => {
  it('derives {2, 1} grid units from the 4 ft and 2 ft panels', () => {
    expect([...DENOMINATIONS_UNITS]).toEqual([2, 1]);
  });

  it('confirms greedy is optimal for the shipping catalog', () => {
    expect(CATALOG_GREEDY_IS_OPTIMAL).toBe(true);
  });
});

describe('minPanelTiling', () => {
  it('uses only 4 ft panels when the wall divides by 4', () => {
    // 24 ft = 12 grid units -> six 4 ft panels.
    expect(minPanelTiling(ftToUnits(24))).toEqual({ counts: [6, 0], totalPanels: 6 });
  });

  it('adds exactly one 2 ft panel for a 2 ft remainder', () => {
    // 26 ft -> six 4 ft panels + one 2 ft panel.
    expect(minPanelTiling(ftToUnits(26))).toEqual({ counts: [6, 1], totalPanels: 7 });
  });

  it('handles the shortest buildable wall', () => {
    expect(minPanelTiling(ftToUnits(2))).toEqual({ counts: [0, 1], totalPanels: 1 });
    expect(minPanelTiling(ftToUnits(4))).toEqual({ counts: [1, 0], totalPanels: 1 });
  });

  it('returns a zero tiling for zero length', () => {
    expect(minPanelCount(0)).toBe(0);
  });

  it('rejects lengths that are not whole grid units', () => {
    expect(minPanelTiling(2.5)).toBeNull();
    expect(minPanelTiling(-1)).toBeNull();
  });

  it('matches the closed form floor(L/4) + (L mod 4 === 2) across the range', () => {
    for (let ft = 2; ft <= 400; ft += 2) {
      const expected = Math.floor(ft / 4) + (ft % 4 === 2 ? 1 : 0);
      expect(minPanelCount(ftToUnits(ft))).toBe(expected);
    }
  });
});

describe('dynamic programming vs greedy', () => {
  it('agrees with greedy for the shipping catalog', () => {
    for (let units = 0; units <= 200; units++) {
      expect(minPanelTilingDP(units)?.totalPanels).toBe(greedyTiling(units)?.totalPanels);
    }
  });

  it('beats greedy on a non-canonical set, so the DP is not redundant', () => {
    // The classic counterexample: {5, 4, 1} filling 8.
    const denoms = [5, 4, 1];
    expect(greedyTiling(8, denoms)?.totalPanels).toBe(4); // 5 + 1 + 1 + 1
    expect(minPanelTilingDP(8, denoms)?.totalPanels).toBe(2); // 4 + 4
    expect(greedyIsOptimalUpTo(denoms, 32)).toBe(false);
  });

  it('falls back to the DP when a catalog is not canonical', () => {
    expect(minPanelTiling(8, [5, 4, 1])?.totalPanels).toBe(2);
  });

  it('reports null when no combination covers the length exactly', () => {
    expect(minPanelTilingDP(7, [4, 2])).toBeNull();
  });
});

describe('tilingSequence', () => {
  it('lays the wide panels first so the remainder lands at the far end', () => {
    expect(tilingSequence(ftToUnits(10))).toEqual(['4x10', '4x10', '2x10']);
  });

  it('returns null for an unbuildable length', () => {
    expect(tilingSequence(1.5)).toBeNull();
  });
});

describe('tileRun', () => {
  it('lays panels end to end along +X with no gap or overlap', () => {
    const panels = tileRun(0, 0, ftToUnits(10), 'h');
    expect(panels).not.toBeNull();
    expect(panels!.map((p) => [p.type, p.x, p.y])).toEqual([
      ['4x10', 0, 0],
      ['4x10', 2, 0],
      ['2x10', 4, 0],
    ]);
  });

  it('lays panels along +Y when vertical', () => {
    const panels = tileRun(3, 1, ftToUnits(6), 'v');
    expect(panels!.map((p) => [p.type, p.x, p.y])).toEqual([
      ['4x10', 3, 1],
      ['2x10', 3, 3],
    ]);
  });

  it('gives every panel a distinct id', () => {
    const panels = tileRun(0, 0, ftToUnits(40), 'h')!;
    expect(new Set(panels.map((p) => p.id)).size).toBe(panels.length);
  });
});
