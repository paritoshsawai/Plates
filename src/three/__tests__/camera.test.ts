import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyOrbit,
  cursorAnchor,
  dollyAboutPoint,
  panTarget,
  panWorldPerPixel,
} from '../controls';
import type { Orbit } from '../controls';

/**
 * The camera rig, exercised with a real `PerspectiveCamera`. None of this needs
 * a WebGL context - projection is pure matrix arithmetic - so the geometry that
 * decides how the controller feels is pinned by ordinary unit tests.
 */

const FOV = 50;
const HEIGHT_PX = 900;

function rig(over: Partial<Orbit> = {}) {
  const camera = new THREE.PerspectiveCamera(FOV, 1.5, 0.5, 2000);
  const orbit: Orbit = {
    radius: 80,
    theta: Math.PI * 0.75,
    phi: Math.PI * 0.35,
    target: new THREE.Vector3(),
    ...over,
  };
  applyOrbit(camera, orbit);
  return { camera, orbit };
}

/** Where a world point lands on screen, in normalised device coordinates. */
function toScreen(camera: THREE.PerspectiveCamera, point: THREE.Vector3): THREE.Vector3 {
  camera.updateMatrixWorld(true);
  return point.clone().project(camera);
}

describe('panTarget', () => {
  const perPixel = () => panWorldPerPixel(80, FOV, HEIGHT_PX);

  it('carries the model with the cursor when dragging right', () => {
    const { camera, orbit } = rig();
    const before = toScreen(camera, new THREE.Vector3());
    panTarget(camera, orbit.target, 100, 0, perPixel());
    applyOrbit(camera, orbit);
    // The world origin was under the centre of the screen; after dragging
    // right it must appear to the right of where it was.
    expect(toScreen(camera, new THREE.Vector3()).x).toBeGreaterThan(before.x);
  });

  it('carries the model with the cursor when dragging down', () => {
    const { camera, orbit } = rig();
    const before = toScreen(camera, new THREE.Vector3());
    panTarget(camera, orbit.target, 0, 100, perPixel());
    applyOrbit(camera, orbit);
    // NDC y runs up the screen, so "appears lower" means a smaller y.
    expect(toScreen(camera, new THREE.Vector3()).y).toBeLessThan(before.y);
  });

  it('moves the target along the screen-up vector for a vertical drag', () => {
    // The regression test for the inverted pan. The old code applied both
    // ground-plane terms with the wrong sign, so the target moved along the
    // screen-up vector reflected through the Y axis: it rose correctly but
    // slid away from the viewer instead of towards them, shearing the model.
    const { camera, orbit } = rig();
    const phi = orbit.phi;
    const theta = orbit.theta;
    const expected = new THREE.Vector3(
      -Math.cos(phi) * Math.sin(theta),
      Math.sin(phi),
      -Math.cos(phi) * Math.cos(theta),
    );

    panTarget(camera, orbit.target, 0, 100, perPixel());
    const moved = orbit.target.clone().normalize();

    expect(moved.x).toBeCloseTo(expected.x, 6);
    expect(moved.y).toBeCloseTo(expected.y, 6);
    expect(moved.z).toBeCloseTo(expected.z, 6);

    // And name the old behaviour directly, so this cannot regress back to it:
    // the vector with both ground-plane terms flipped must be a different one.
    const inverted = new THREE.Vector3(
      Math.cos(phi) * Math.sin(theta),
      Math.sin(phi),
      Math.cos(phi) * Math.cos(theta),
    ).normalize();
    expect(moved.distanceTo(inverted)).toBeGreaterThan(0.1);
  });

  it('moves the target along the screen-right vector for a horizontal drag', () => {
    const { camera, orbit } = rig();
    const theta = orbit.theta;
    panTarget(camera, orbit.target, 100, 0, perPixel());
    const moved = orbit.target.clone().normalize();
    // Right is (cos theta, 0, -sin theta); the target moves the other way.
    expect(moved.x).toBeCloseTo(-Math.cos(theta), 6);
    expect(moved.y).toBeCloseTo(0, 6);
    expect(moved.z).toBeCloseTo(Math.sin(theta), 6);
  });

  it('tracks the cursor one for one', () => {
    // A 100 px drag must move the model 100 px, not 150. This is the whole
    // reason the pan scale is derived rather than guessed.
    const { camera, orbit } = rig();
    const before = toScreen(camera, new THREE.Vector3());
    panTarget(camera, orbit.target, 0, 100, perPixel());
    applyOrbit(camera, orbit);
    const after = toScreen(camera, new THREE.Vector3());
    // NDC spans 2 over the full height, so 100 px is 200 / HEIGHT_PX in NDC.
    expect(before.y - after.y).toBeCloseTo((100 * 2) / HEIGHT_PX, 2);
  });

  it('is reversible: dragging back returns the target exactly', () => {
    const { camera, orbit } = rig();
    panTarget(camera, orbit.target, 70, -40, perPixel());
    panTarget(camera, orbit.target, -70, 40, perPixel());
    expect(orbit.target.length()).toBeCloseTo(0, 6);
  });

  it('works from directly overhead, where trigonometric derivations degenerate', () => {
    const { camera, orbit } = rig({ phi: 0.12 });
    panTarget(camera, orbit.target, 0, 100, perPixel());
    expect(orbit.target.length()).toBeGreaterThan(0);
    expect(Number.isFinite(orbit.target.x)).toBe(true);
  });
});

describe('dollyAboutPoint', () => {
  const ndc = (x: number, y: number) => new THREE.Vector2(x, y);

  it('keeps the point under the cursor exactly where it was', () => {
    const { camera, orbit } = rig();
    const anchor = cursorAnchor(camera, ndc(0.6, -0.4), orbit.target);
    const before = toScreen(camera, anchor);

    dollyAboutPoint(orbit, anchor, 0.5);
    applyOrbit(camera, orbit);

    const after = toScreen(camera, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('holds the anchor for a zoom out as well as a zoom in', () => {
    const { camera, orbit } = rig();
    const anchor = cursorAnchor(camera, ndc(-0.8, 0.3), orbit.target);
    const before = toScreen(camera, anchor);

    dollyAboutPoint(orbit, anchor, 1.6);
    applyOrbit(camera, orbit);

    expect(toScreen(camera, anchor).x).toBeCloseTo(before.x, 6);
    expect(toScreen(camera, anchor).y).toBeCloseTo(before.y, 6);
  });

  it('actually changes the distance', () => {
    const { orbit } = rig();
    const anchor = new THREE.Vector3(10, 0, 10);
    dollyAboutPoint(orbit, anchor, 0.5);
    expect(orbit.radius).toBe(40);
  });

  it('leaves the orientation untouched, so zooming never rolls the view', () => {
    const { camera, orbit } = rig();
    const before = camera.quaternion.clone();
    dollyAboutPoint(orbit, new THREE.Vector3(12, 3, -7), 0.7);
    applyOrbit(camera, orbit);
    expect(camera.quaternion.angleTo(before)).toBeCloseTo(0, 6);
  });

  it('pulls the target towards the cursor, which is what lets you reach a corner', () => {
    const { camera, orbit } = rig();
    const anchor = cursorAnchor(camera, ndc(0.9, 0.9), orbit.target);
    const distanceBefore = orbit.target.distanceTo(anchor);
    dollyAboutPoint(orbit, anchor, 0.5);
    expect(orbit.target.distanceTo(anchor)).toBeLessThan(distanceBefore);
  });

  it('is a no-op at factor 1', () => {
    const { orbit } = rig();
    dollyAboutPoint(orbit, new THREE.Vector3(5, 5, 5), 1);
    expect(orbit.radius).toBe(80);
    expect(orbit.target.length()).toBeCloseTo(0, 10);
  });
});

describe('cursorAnchor', () => {
  it('returns the target itself for a cursor at the centre of the screen', () => {
    const { camera, orbit } = rig({ target: new THREE.Vector3(4, 1, -2) });
    const anchor = cursorAnchor(camera, new THREE.Vector2(0, 0), orbit.target);
    expect(anchor.distanceTo(orbit.target)).toBeCloseTo(0, 6);
  });

  it('finds a point even when the camera looks along the horizon', () => {
    // A ground-plane intersection would miss here; the target plane cannot.
    const { camera, orbit } = rig({ phi: Math.PI / 2.05 });
    const anchor = cursorAnchor(camera, new THREE.Vector2(0.5, 0.9), orbit.target);
    expect(Number.isFinite(anchor.x)).toBe(true);
    expect(Number.isFinite(anchor.y)).toBe(true);
  });

  it('puts the anchor to the right of the target for a cursor to the right', () => {
    const { camera, orbit } = rig();
    const anchor = cursorAnchor(camera, new THREE.Vector2(0.7, 0), orbit.target);
    expect(toScreen(camera, anchor).x).toBeCloseTo(0.7, 4);
  });
});
