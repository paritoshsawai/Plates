/**
 * Units and the modular grid.
 *
 * Arplace builds from exactly two wall panels: 4 ft x 10 ft and 2 ft x 10 ft.
 * Neither may be cut or resized, so the design grid is GCD(4, 2) = 2 ft. Every
 * wall length that is a whole multiple of 2 ft can be tiled by these two panels
 * with zero offcut; nothing else can be built at all.
 *
 * Internally the app never stores feet as floats. One integer "unit" is one
 * 2 ft grid cell, so panel geometry is exact integer arithmetic and the
 * validation engine reduces to integer bookkeeping.
 */

/** Length of the basic module, in feet. GCD of the two panel widths. */
export const GRID_FT = 2;

/** Wall height, in feet. Both panels are 10 ft tall; this is not configurable. */
export const WALL_HEIGHT_FT = 10;

/** Convert a real-world length in feet to integer grid units. */
export function ftToUnits(ft: number): number {
  return ft / GRID_FT;
}

/** Convert integer grid units back to feet. */
export function unitsToFt(units: number): number {
  return units * GRID_FT;
}

/** True when a length in feet lands exactly on the 2 ft module. */
export function isModularFt(ft: number): boolean {
  return Number.isFinite(ft) && Math.abs(ft / GRID_FT - Math.round(ft / GRID_FT)) < 1e-9;
}

/**
 * Nearest buildable length to `ft`, used to turn an invalid dimension into an
 * actionable suggestion ("34 ft is not buildable - use 34 ft or 36 ft").
 * Never returns 0 for a positive input: the smallest real wall is one panel.
 */
export function nearestModularFt(ft: number): { down: number; up: number } {
  const down = Math.max(GRID_FT, Math.floor(ft / GRID_FT) * GRID_FT);
  const up = Math.max(GRID_FT, Math.ceil(ft / GRID_FT) * GRID_FT);
  return { down, up };
}

/** Round a length in feet onto the module (used when snapping typed input). */
export function snapFt(ft: number): number {
  return Math.round(ft / GRID_FT) * GRID_FT;
}

/** Human-readable feet, e.g. 26 -> "26 ft". */
export function formatFt(ft: number): string {
  const rounded = Math.round(ft * 100) / 100;
  return `${rounded} ft`;
}
