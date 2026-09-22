import { describe, expect, it } from 'vitest';
import { PLAN_SCHEMA_VERSION, createPlan, deserializePlan, serializePlan } from '../plan';
import { calibrationScale, downscaleFactor } from '../../canvas/underlay';
import { GRID_FT } from '../units';

const PLOT = { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };
const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function planWith(underlay: unknown): string {
  return JSON.stringify({ plot: PLOT, panels: [], underlay });
}

describe('downscaleFactor', () => {
  it('leaves an image that already fits alone', () => {
    expect(downscaleFactor(1600, 1200, 2000)).toBe(1);
  });

  it('brings the longest edge down to the limit', () => {
    expect(downscaleFactor(4000, 3000, 2000)).toBe(0.5);
    expect(downscaleFactor(3000, 4000, 2000)).toBe(0.5);
  });
});

describe('calibrationScale', () => {
  it('derives grid units per pixel from a known real distance', () => {
    // 100 px that are really 20 ft = 10 grid units -> 0.1 units per pixel.
    expect(calibrationScale(100, 20, GRID_FT)).toBeCloseTo(0.1, 9);
  });

  it('refuses a zero or negative span, which would divide by zero', () => {
    expect(calibrationScale(0, 20, GRID_FT)).toBeNull();
    expect(calibrationScale(100, 0, GRID_FT)).toBeNull();
    expect(calibrationScale(-5, 20, GRID_FT)).toBeNull();
  });
});

describe('underlay persistence', () => {
  it('round-trips through save and load', () => {
    const plan = createPlan('Traced');
    plan.underlay = { dataUrl: PIXEL, x: 2, y: -1, scale: 0.05, opacity: 0.4, name: 'survey.png' };

    const restored = deserializePlan(serializePlan(plan));
    expect(restored.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
    expect(restored.underlay).toEqual(plan.underlay);
  });

  it('drops an underlay with no usable scale rather than rendering it wrong', () => {
    expect(deserializePlan(planWith({ dataUrl: PIXEL, scale: 0 })).underlay).toBeUndefined();
    expect(deserializePlan(planWith({ dataUrl: PIXEL })).underlay).toBeUndefined();
  });

  it('refuses a remote image, which an import must never fetch', () => {
    const remote = { dataUrl: 'https://example.com/plan.png', scale: 0.1 };
    expect(deserializePlan(planWith(remote)).underlay).toBeUndefined();
  });

  it('clamps opacity into a visible range', () => {
    const tooFaint = deserializePlan(planWith({ dataUrl: PIXEL, scale: 0.1, opacity: 0 }));
    expect(tooFaint.underlay!.opacity).toBe(0.05);
    const tooStrong = deserializePlan(planWith({ dataUrl: PIXEL, scale: 0.1, opacity: 9 }));
    expect(tooStrong.underlay!.opacity).toBe(1);
  });

  it('defaults position and name when they are missing', () => {
    const plan = deserializePlan(planWith({ dataUrl: PIXEL, scale: 0.1 }));
    expect(plan.underlay).toMatchObject({ x: 0, y: 0, name: 'Underlay' });
  });

  it('loads a schema 3 plan that has no underlay at all', () => {
    const raw = JSON.stringify({ schemaVersion: 3, plot: PLOT, panels: [] });
    const plan = deserializePlan(raw);
    expect(plan.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
    expect(plan.underlay).toBeUndefined();
  });
});
