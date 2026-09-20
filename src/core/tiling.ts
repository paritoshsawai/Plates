/**
 * Minimum-panel tiling of a straight wall run.
 *
 * Covering a wall of length L with panels of fixed widths and no cutting is the
 * coin-change problem. With Arplace's two widths - 4 ft and 2 ft, i.e. 2 and 1
 * grid units - greedy is optimal, so the closed form is
 *
 *     fours = floor(L_ft / 4),  twos = (L_ft mod 4 === 2) ? 1 : 0
 *
 * Greedy is NOT optimal for arbitrary denominations: with {1, 4, 5} greedy
 * fills 8 as 5+1+1+1 (four coins) where 4+4 (two coins) is optimal. So the
 * dynamic-programming solver below is the real implementation and the greedy
 * closed form is only a fast path, guarded by `greedyIsOptimalUpTo`. If Arplace
 * ever adds a third panel size, the guard fails over to the DP automatically
 * and the quotes stay correct.
 */

import { DENOMINATION_SIZES, DENOMINATIONS_UNITS, getPanelSpec, newPanelId } from './panels';
import type { Orientation, Panel, PanelCategory, PanelSizeId } from './types';

export interface Tiling {
  /** Counts aligned to the denominations array passed in, largest first. */
  counts: number[];
  totalPanels: number;
}

/**
 * Fewest panels covering exactly `lengthUnits`, by dynamic programming.
 *
 * C[p] = 0                                   if p = 0
 * C[p] = min over d <= p of { 1 + C[p - d] } otherwise
 *
 * Theta(n * k) time, Theta(n) space, where n = lengthUnits and k = |denoms|.
 * Returns null when the length cannot be covered exactly, which for Arplace
 * means the wall is not a multiple of the 2 ft module and is unbuildable.
 */
export function minPanelTilingDP(
  lengthUnits: number,
  denoms: readonly number[] = DENOMINATIONS_UNITS,
): Tiling | null {
  if (!Number.isInteger(lengthUnits) || lengthUnits < 0) return null;
  if (lengthUnits === 0) return { counts: denoms.map(() => 0), totalPanels: 0 };

  const INF = Number.POSITIVE_INFINITY;
  const best = new Array<number>(lengthUnits + 1).fill(INF);
  const choice = new Array<number>(lengthUnits + 1).fill(-1);
  best[0] = 0;

  for (let p = 1; p <= lengthUnits; p++) {
    for (let d = 0; d < denoms.length; d++) {
      const w = denoms[d];
      if (w > p) continue;
      const candidate = best[p - w] + 1;
      if (candidate < best[p]) {
        best[p] = candidate;
        choice[p] = d;
      }
    }
  }

  if (best[lengthUnits] === INF) return null;

  const counts = denoms.map(() => 0);
  let remaining = lengthUnits;
  while (remaining > 0) {
    const d = choice[remaining];
    if (d < 0) return null;
    counts[d] += 1;
    remaining -= denoms[d];
  }
  return { counts, totalPanels: best[lengthUnits] };
}

/** Greedy: take the widest panel that fits, repeatedly. Only valid when the
 * denomination set is canonical - use `greedyIsOptimalUpTo` to check. */
export function greedyTiling(
  lengthUnits: number,
  denoms: readonly number[] = DENOMINATIONS_UNITS,
): Tiling | null {
  if (!Number.isInteger(lengthUnits) || lengthUnits < 0) return null;
  const counts = denoms.map(() => 0);
  let remaining = lengthUnits;
  let total = 0;
  for (let d = 0; d < denoms.length; d++) {
    const take = Math.floor(remaining / denoms[d]);
    counts[d] = take;
    total += take;
    remaining -= take * denoms[d];
  }
  return remaining === 0 ? { counts, totalPanels: total } : null;
}

/**
 * Whether greedy matches the DP optimum for every length up to `limit`.
 *
 * Deciding canonicality in general needs Pearson's algorithm; for a two- or
 * three-denomination catalog a bounded scan is exact enough to be worth
 * trusting, and cheap. Computed once at module load for the real catalog.
 */
export function greedyIsOptimalUpTo(denoms: readonly number[], limit = 512): boolean {
  for (let n = 0; n <= limit; n++) {
    const dp = minPanelTilingDP(n, denoms);
    const g = greedyTiling(n, denoms);
    if ((dp === null) !== (g === null)) return false;
    if (dp && g && dp.totalPanels !== g.totalPanels) return false;
  }
  return true;
}

/** Cached for the shipping catalog: true for {2, 1} grid units (4 ft, 2 ft). */
export const CATALOG_GREEDY_IS_OPTIMAL = greedyIsOptimalUpTo(DENOMINATIONS_UNITS);

/**
 * Fewest panels covering `lengthUnits` exactly, using the fast path when the
 * catalog allows it and the DP otherwise. This is the single entry point the
 * rest of the app should call.
 */
export function minPanelTiling(
  lengthUnits: number,
  denoms: readonly number[] = DENOMINATIONS_UNITS,
): Tiling | null {
  if (denoms === DENOMINATIONS_UNITS && CATALOG_GREEDY_IS_OPTIMAL) {
    return greedyTiling(lengthUnits, denoms);
  }
  return greedyIsOptimalUpTo(denoms)
    ? greedyTiling(lengthUnits, denoms)
    : minPanelTilingDP(lengthUnits, denoms);
}

/** Just the panel count, or null when the length is not buildable. */
export function minPanelCount(lengthUnits: number): number | null {
  return minPanelTiling(lengthUnits)?.totalPanels ?? null;
}

/**
 * The optimal tiling as an ordered list of panel types, widest first, ready to
 * lay along a wall run. A remainder panel therefore lands at the far end.
 */
export function tilingSequence(lengthUnits: number): PanelSizeId[] | null {
  const tiling = minPanelTiling(lengthUnits);
  if (!tiling) return null;
  const sequence: PanelSizeId[] = [];
  tiling.counts.forEach((count, i) => {
    for (let n = 0; n < count; n++) sequence.push(DENOMINATION_SIZES[i]);
  });
  return sequence;
}

/**
 * Auto-fill: lay the minimum-panel tiling along the run that starts at
 * (x, y) and extends `lengthUnits` in `orientation`. Returns null for a run
 * that cannot be built from the catalog.
 */
export function tileRun(
  x: number,
  y: number,
  lengthUnits: number,
  orientation: Orientation,
  category: PanelCategory = 'wall',
): Panel[] | null {
  const sequence = tilingSequence(lengthUnits);
  if (!sequence) return null;

  const panels: Panel[] = [];
  let cursor = 0;
  for (const size of sequence) {
    panels.push({
      id: newPanelId(),
      category,
      size,
      x: orientation === 'h' ? x + cursor : x,
      y: orientation === 'h' ? y : y + cursor,
      orientation,
    });
    cursor += getPanelSpec(size).widthUnits;
  }
  return panels;
}
