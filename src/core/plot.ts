/**
 * Plot boundary geometry. The boundary is a closed rectilinear ring of grid
 * nodes, so every vertex already sits on the 2 ft module and the area and
 * perimeter are exact.
 */

import { GRID_FT, unitsToFt } from './units';
import type { GridPoint, Plot } from './types';

/**
 * An axis-aligned plot from a width and length in feet.
 *
 * Dimensions are rounded *down* onto the 2 ft module, never up: the buildable
 * area must never exceed the surveyed parcel. A 61 ft frontage yields a 60 ft
 * design area, and the setup screen tells the user what was given up.
 */
export function rectPlotFromFt(widthFt: number, lengthFt: number): Plot {
  const w = Math.max(1, Math.floor(widthFt / GRID_FT));
  const h = Math.max(1, Math.floor(lengthFt / GRID_FT));
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  };
}

export function plotBboxUnits(plot: Plot): { minX: number; minY: number; maxX: number; maxY: number } {
  if (plot.vertices.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of plot.vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Signed-area (shoelace) magnitude, converted to square feet. */
export function plotAreaSqFt(plot: Plot): number {
  const v = plot.vertices;
  if (v.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const areaUnits = Math.abs(twiceArea) / 2;
  return areaUnits * GRID_FT * GRID_FT;
}

export function plotPerimeterFt(plot: Plot): number {
  const v = plot.vertices;
  if (v.length < 2) return 0;
  let units = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    units += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return unitsToFt(units);
}

/** The boundary's edge lengths in feet, in ring order. */
export function plotEdgeLengthsFt(plot: Plot): number[] {
  const v = plot.vertices;
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    out.push(unitsToFt(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));
  }
  return out;
}

/** True when consecutive vertices always differ on exactly one axis. */
export function isRectilinear(plot: Plot): boolean {
  const v = plot.vertices;
  if (v.length < 4) return false;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if ((dx === 0) === (dy === 0)) return false;
  }
  return true;
}

function onSegment(p: GridPoint, a: GridPoint, b: GridPoint): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/**
 * Point-in-polygon including the boundary itself. Walls are expected to sit on
 * the plot line, so a point on the edge counts as inside.
 *
 * Works on half-integer coordinates too, which is how segment midpoints are
 * tested.
 */
export function containsPoint(plot: Plot, p: GridPoint): boolean {
  const v = plot.vertices;
  if (v.length < 3) return false;

  for (let i = 0; i < v.length; i++) {
    if (onSegment(p, v[i], v[(i + 1) % v.length])) return true;
  }

  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const yi = v[i].y;
    const yj = v[j].y;
    if (yi > p.y !== yj > p.y) {
      const xCross = ((v[j].x - v[i].x) * (p.y - yi)) / (yj - yi) + v[i].x;
      if (p.x < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a 2 ft wall segment lies within the plot. Both endpoints and the
 * midpoint must be inside-or-on, which rejects a segment that spans a concave
 * notch while accepting one that runs along the boundary.
 */
export function containsSegment(plot: Plot, a: GridPoint, b: GridPoint): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return containsPoint(plot, a) && containsPoint(plot, b) && containsPoint(plot, mid);
}

/** Translate the whole ring, used when a drawn boundary has negative nodes. */
export function normalizePlot(plot: Plot): Plot {
  const { minX, minY } = plotBboxUnits(plot);
  if (minX === 0 && minY === 0) return plot;
  return { vertices: plot.vertices.map((v) => ({ x: v.x - minX, y: v.y - minY })) };
}
