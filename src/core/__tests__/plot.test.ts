import { describe, expect, it } from 'vitest';
import {
  containsPoint,
  containsSegment,
  isRectilinear,
  normalizePlot,
  plotAreaSqFt,
  plotEdgeLengthsFt,
  plotPerimeterFt,
  rectPlotFromFt,
} from '../plot';
import { isModularFt, nearestModularFt, snapFt } from '../units';
import type { Plot } from '../types';

describe('units', () => {
  it('recognises lengths that land on the 2 ft module', () => {
    expect(isModularFt(24)).toBe(true);
    expect(isModularFt(26)).toBe(true);
    expect(isModularFt(25)).toBe(false);
  });

  it('suggests the nearest buildable lengths for a non-modular dimension', () => {
    expect(nearestModularFt(35)).toEqual({ down: 34, up: 36 });
  });

  it('never suggests a zero-length wall', () => {
    expect(nearestModularFt(0.5)).toEqual({ down: 2, up: 2 });
  });

  it('snaps typed input onto the module', () => {
    expect(snapFt(35)).toBe(36);
    expect(snapFt(34.9)).toBe(34);
  });
});

describe('rectPlotFromFt', () => {
  it('rounds a non-modular plot down, never claiming land the parcel lacks', () => {
    const plot = rectPlotFromFt(61, 39);
    expect(plotEdgeLengthsFt(plot)).toEqual([60, 38, 60, 38]);
  });

  it('keeps at least one module even for a tiny parcel', () => {
    expect(plotEdgeLengthsFt(rectPlotFromFt(1, 1))).toEqual([2, 2, 2, 2]);
  });

  it('computes area and perimeter in real-world units', () => {
    const plot = rectPlotFromFt(60, 40);
    expect(plotAreaSqFt(plot)).toBe(2400);
    expect(plotPerimeterFt(plot)).toBe(200);
  });

  it('is rectilinear', () => {
    expect(isRectilinear(rectPlotFromFt(60, 40))).toBe(true);
  });
});

describe('containsPoint', () => {
  const plot = rectPlotFromFt(20, 20); // 10 x 10 grid units

  it('treats the boundary itself as inside, so walls may sit on the plot line', () => {
    expect(containsPoint(plot, { x: 0, y: 0 })).toBe(true);
    expect(containsPoint(plot, { x: 5, y: 0 })).toBe(true);
    expect(containsPoint(plot, { x: 10, y: 10 })).toBe(true);
  });

  it('accepts interior points and rejects exterior ones', () => {
    expect(containsPoint(plot, { x: 5, y: 5 })).toBe(true);
    expect(containsPoint(plot, { x: 11, y: 5 })).toBe(false);
    expect(containsPoint(plot, { x: -1, y: 5 })).toBe(false);
  });
});

describe('containsSegment on an L-shaped plot', () => {
  // An L: the notch is the top-right quadrant.
  const lPlot: Plot = {
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ],
  };

  it('is not rectilinear-broken by the concave corner', () => {
    expect(isRectilinear(lPlot)).toBe(true);
  });

  it('computes the L area by the shoelace formula', () => {
    // 100 grid-unit cells minus the 25-cell notch, each cell 4 sq ft.
    expect(plotAreaSqFt(lPlot)).toBe(75 * 4);
  });

  it('accepts a segment along the inner boundary', () => {
    expect(containsSegment(lPlot, { x: 5, y: 5 }, { x: 5, y: 6 })).toBe(true);
  });

  it('rejects a segment inside the notch', () => {
    expect(containsSegment(lPlot, { x: 7, y: 7 }, { x: 8, y: 7 })).toBe(false);
  });

  it('rejects a segment whose endpoints are inside but whose span is not', () => {
    // Both endpoints sit on the boundary, the midpoint is out in the notch.
    expect(containsSegment(lPlot, { x: 5, y: 8 }, { x: 5, y: 10 })).toBe(true);
    expect(containsSegment(lPlot, { x: 10, y: 5 }, { x: 5, y: 10 })).toBe(false);
  });
});

describe('normalizePlot', () => {
  it('shifts a boundary drawn at negative coordinates to the origin', () => {
    const shifted: Plot = {
      vertices: [
        { x: -4, y: -2 },
        { x: 6, y: -2 },
        { x: 6, y: 8 },
        { x: -4, y: 8 },
      ],
    };
    expect(normalizePlot(shifted).vertices[0]).toEqual({ x: 0, y: 0 });
    expect(plotAreaSqFt(normalizePlot(shifted))).toBe(plotAreaSqFt(shifted));
  });

  it('leaves an already-normalised plot untouched', () => {
    const plot = rectPlotFromFt(20, 20);
    expect(normalizePlot(plot)).toBe(plot);
  });
});
