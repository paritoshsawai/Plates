import { describe, expect, it } from 'vitest';
import { fitRadius } from '../scene';

/** Half-angle a camera at `distance` can see, given a field of view. */
function visibleHalfExtent(distance: number, fovDegrees: number): number {
  return distance * Math.tan(((fovDegrees * Math.PI) / 180) / 2);
}

describe('fitRadius', () => {
  const FOV = 50;

  it('keeps the whole sphere inside the vertical field of view', () => {
    const r = 15;
    const distance = fitRadius(r, FOV, 1);
    expect(visibleHalfExtent(distance, FOV)).toBeGreaterThan(r);
  });

  it('pulls further back for a tall, narrow pane, where width is the limit', () => {
    // Aspect below 1 means the horizontal field of view is the tighter one.
    const narrow = fitRadius(15, FOV, 0.5);
    const square = fitRadius(15, FOV, 1);
    expect(narrow).toBeGreaterThan(square);
  });

  it('does not pull further back than necessary for a wide pane', () => {
    // Beyond square, the vertical field of view already governs.
    expect(fitRadius(15, FOV, 2)).toBeCloseTo(fitRadius(15, FOV, 1), 6);
  });

  it('keeps the sphere inside the horizontal field of view too', () => {
    const r = 15;
    const aspect = 0.5;
    const distance = fitRadius(r, FOV, aspect);
    // Horizontal half-extent is the vertical one scaled by the aspect ratio.
    expect(visibleHalfExtent(distance, FOV) * aspect).toBeGreaterThan(r);
  });

  it('scales linearly with the size of the building', () => {
    expect(fitRadius(30, FOV, 1)).toBeCloseTo(fitRadius(15, FOV, 1) * 2, 6);
  });

  it('never collapses to zero for an empty or degenerate model', () => {
    expect(fitRadius(0, FOV, 1)).toBeGreaterThan(0);
    expect(fitRadius(10, FOV, 0)).toBeGreaterThan(0);
  });
});
