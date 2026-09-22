import { describe, expect, it } from 'vitest';
import {
  dampen,
  normalizeWheelDelta,
  orbitRadiansPerPixel,
  panWorldPerPixel,
  zoomFactor,
} from '../controls';

/** Apply a burst of wheel events and report the total radius multiplier. */
function burst(count: number, deltaY: number, deltaMode = 0): number {
  let factor = 1;
  for (let i = 0; i < count; i++) factor *= zoomFactor(normalizeWheelDelta(deltaY, deltaMode));
  return factor;
}

describe('wheel zoom', () => {
  it('gives one mouse notch roughly the 1.1x step a wheel used to get', () => {
    expect(zoomFactor(normalizeWheelDelta(100))).toBeCloseTo(1.1, 1);
  });

  it('does not let a trackpad flick run away', () => {
    // The bug: twenty small trackpad events each took a full 10% step, so a
    // gentle two-finger scroll zoomed by 1.1^20, about 6.7x.
    const runaway = 1.1 ** 20;
    const actual = burst(20, 3);
    expect(runaway).toBeGreaterThan(6);
    expect(actual).toBeLessThan(1.1);
  });

  it('is proportional: a flick of twice the travel zooms twice as far in log terms', () => {
    expect(Math.log(burst(20, 3))).toBeCloseTo(Math.log(burst(10, 3)) * 2, 6);
  });

  it('composes, so many small events equal one big one of the same total travel', () => {
    expect(burst(10, 10)).toBeCloseTo(zoomFactor(normalizeWheelDelta(100)), 6);
  });

  it('zooms out for a positive delta and in for a negative one', () => {
    expect(zoomFactor(normalizeWheelDelta(100))).toBeGreaterThan(1);
    expect(zoomFactor(normalizeWheelDelta(-100))).toBeLessThan(1);
  });

  it('is symmetric: scrolling back undoes the zoom exactly', () => {
    expect(zoomFactor(120) * zoomFactor(-120)).toBeCloseTo(1, 10);
  });

  it('clamps a single violent event', () => {
    expect(zoomFactor(normalizeWheelDelta(100000))).toBeLessThanOrEqual(2);
    expect(zoomFactor(normalizeWheelDelta(-100000))).toBeGreaterThanOrEqual(0.5);
  });
});

describe('normalizeWheelDelta', () => {
  it('passes pixel deltas through unchanged', () => {
    expect(normalizeWheelDelta(100, 0)).toBe(100);
  });

  it('scales line deltas, so Firefox behaves like every other browser', () => {
    // Firefox reports 3 lines where Chrome reports about 100 pixels.
    const firefox = zoomFactor(normalizeWheelDelta(3, 1));
    const chrome = zoomFactor(normalizeWheelDelta(100, 0));
    expect(Math.log(firefox) / Math.log(chrome)).toBeGreaterThan(0.3);
    expect(Math.log(firefox) / Math.log(chrome)).toBeLessThan(1.5);
  });

  it('scales page deltas', () => {
    expect(normalizeWheelDelta(2, 2)).toBe(200);
  });
});

describe('dampen', () => {
  it('moves towards the target without overshooting', () => {
    const next = dampen(0, 10, 1 / 60, 0.08);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
  });

  it('covers the same ground in the same wall-clock time at any frame rate', () => {
    // The point of easing on dt rather than per frame: a 120 Hz machine must
    // not settle four times faster than a 30 Hz one. Exponential easing makes
    // this exact - the remaining distance is multiplied by exp(-dt/tau) each
    // step, so n steps of dt equal one step of n*dt - hence the tight bound.
    const settleOver = (seconds: number, hz: number) => {
      let value = 0;
      for (let i = 0; i < seconds * hz; i++) value = dampen(value, 10, 1 / hz, 0.08);
      return value;
    };
    expect(settleOver(0.2, 120)).toBeCloseTo(settleOver(0.2, 60), 9);
    expect(settleOver(0.2, 30)).toBeCloseTo(settleOver(0.2, 60), 9);
  });

  it('covers about 63% of the distance in one time constant', () => {
    expect(dampen(0, 10, 0.08, 0.08)).toBeCloseTo(6.32, 1);
  });

  it('snaps to the target for a degenerate time constant', () => {
    expect(dampen(0, 10, 1 / 60, 0)).toBe(10);
  });

  it('converges rather than oscillating, even for a long frame', () => {
    // A tab that was backgrounded hands back a huge dt; it must not overshoot.
    expect(dampen(0, 10, 5, 0.08)).toBeLessThanOrEqual(10);
    expect(dampen(0, 10, 5, 0.08)).toBeGreaterThan(9.9);
  });
});

describe('panWorldPerPixel', () => {
  it('matches the viewport height the camera actually sees', () => {
    // At the target plane the viewport spans 2 * r * tan(fov/2) world units.
    const radius = 80;
    const fov = 50;
    const height = 900;
    const span = 2 * radius * Math.tan((fov * Math.PI) / 180 / 2);
    expect(panWorldPerPixel(radius, fov, height) * height).toBeCloseTo(span, 6);
  });

  it('is slower than the constant the controller used to guess', () => {
    // The old value was radius * 0.0016, which panned about 1.5x too fast, so
    // the model slid out from under the cursor.
    expect(panWorldPerPixel(80, 50, 900)).toBeLessThan(80 * 0.0016);
  });

  it('scales with distance, so a far view pans further per pixel', () => {
    expect(panWorldPerPixel(160, 50, 900)).toBeCloseTo(panWorldPerPixel(80, 50, 900) * 2, 6);
  });

  it('is safe for a pane with no height yet', () => {
    expect(panWorldPerPixel(80, 50, 0)).toBe(0);
  });
});

describe('orbitRadiansPerPixel', () => {
  it('makes a drag of the canvas height one full turn', () => {
    expect(orbitRadiansPerPixel(900) * 900).toBeCloseTo(Math.PI * 2, 10);
  });

  it('is slower on a taller pane, so the feel does not change with layout', () => {
    expect(orbitRadiansPerPixel(1800)).toBeLessThan(orbitRadiansPerPixel(900));
  });

  it('is safe for a pane with no height yet', () => {
    expect(orbitRadiansPerPixel(0)).toBe(0);
  });
});
