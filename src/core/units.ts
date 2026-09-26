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

/**
 * The unit the user reads and types in.
 *
 * Display only. The model stays in feet, and the module stays 2 ft, because
 * that is what Arplace manufactures - see the note on `formatLength`.
 */
export type LengthUnit = 'ft' | 'm';

/** Exact, by definition of the international foot. */
export const M_PER_FT = 0.3048;

/** A length in feet, expressed in the user's unit. */
export function toDisplay(ft: number, unit: LengthUnit): number {
  return unit === 'm' ? ft * M_PER_FT : ft;
}

/** A length the user typed, back in feet. The model only ever stores feet. */
export function fromDisplay(value: number, unit: LengthUnit): number {
  return unit === 'm' ? value / M_PER_FT : value;
}

/** An area in square feet, expressed in the user's unit. */
export function areaToDisplay(sqFt: number, unit: LengthUnit): number {
  return unit === 'm' ? sqFt * M_PER_FT * M_PER_FT : sqFt;
}

/**
 * A length for reading, e.g. 26 -> "26 ft" or "7.92 m".
 *
 * Measured quantities go through here; *product* dimensions do not. A panel is
 * 4 ft x 10 ft and the module is 2 ft in every unit, because those are
 * catalogue facts rather than measurements of the drawing - converting them
 * would change the SKUs the factory reads off a work order.
 *
 * Two decimals, which feet have always had and metres need: one module is
 * 0.6096 m, so at one decimal two different buildable sizes print the same.
 */
export function formatLength(ft: number, unit: LengthUnit = 'ft'): string {
  const rounded = Math.round(toDisplay(ft, unit) * 100) / 100;
  return `${rounded} ${unit}`;
}

/** An area for reading, grouped Indian-style, e.g. "2,400 sq ft" / "222.97 m²". */
export function formatArea(sqFt: number, unit: LengthUnit = 'ft'): string {
  const value = areaToDisplay(sqFt, unit);
  if (unit === 'm') {
    return `${value.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} m²`;
  }
  return `${Math.round(value).toLocaleString('en-IN')} sq ft`;
}

/** Bare unit name, for a column header or an input suffix. */
export function areaUnitLabel(unit: LengthUnit): string {
  return unit === 'm' ? 'm²' : 'sq ft';
}

/**
 * A length in feet, as the number to *pre-fill a dimension input* with.
 *
 * Rounded so the value is never below the true one. 40 ft is 12.192 m, and a
 * box pre-filled with 12.19 m applies as 39.99 ft, which floors to 38 ft: the
 * plot would lose a whole module just from the dialog being reopened. Rounding
 * up caps the error at 0.01 m, far inside one 0.6096 m module, so a dimension
 * already on the module always comes back as itself.
 */
export function toInputValue(ft: number, unit: LengthUnit): number {
  if (unit !== 'm') return ft;
  return Math.ceil(toDisplay(ft, 'm') * 100) / 100;
}

/**
 * How to name the module in prose. It is 2 ft in both units - that is what
 * Arplace makes - but a metric reader needs the size in their own terms too.
 */
export function moduleLabel(unit: LengthUnit): string {
  return unit === 'm' ? `${GRID_FT} ft (${formatLength(GRID_FT, 'm')})` : `${GRID_FT} ft`;
}

/** Step for a length input: 1 ft, or 0.1 m - roughly a sixth of a module either way. */
export function inputStep(unit: LengthUnit): number {
  return unit === 'm' ? 0.1 : 1;
}

/**
 * Smallest length a dimension input should accept: one module, in the user's
 * unit. Rounded *up* at two decimals so the typed floor is never below one
 * real module (0.6096 m would floor to 0.6 m, which buys nothing).
 */
export function inputMin(unit: LengthUnit): number {
  return unit === 'm' ? Math.ceil(toDisplay(GRID_FT, 'm') * 100) / 100 : GRID_FT;
}

/** Human-readable feet, e.g. 26 -> "26 ft". */
export function formatFt(ft: number): string {
  return formatLength(ft, 'ft');
}
