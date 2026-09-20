/**
 * The 3D camera controller: the orbit rig and the arithmetic that drives it.
 *
 * Kept out of `ThreeView.tsx` for the same reason `fitRadius` is kept in
 * `scene.ts`: none of it needs a canvas, a WebGL context or a DOM, so all of it
 * is testable directly. That matters most for the vector work - an earlier
 * version derived the pan basis from hand-written trigonometry and had the sign
 * of both ground-plane terms inverted, so a vertical drag sheared the model
 * diagonally. Reading the basis off the camera's own matrix, below, cannot go
 * wrong that way, and the tests pin the directions regardless.
 */

import * as THREE from 'three';

/**
 * A wheel event's delta in CSS pixels.
 *
 * `deltaY` alone is not comparable between devices. A mouse wheel notch is one
 * event of about 100; a trackpad two-finger scroll is a stream of events of 1
 * to 4. Firefox reports lines (`deltaMode` 1) rather than pixels, and a
 * page-scroll wheel reports pages (2). Reading only the *sign*, as this did
 * before, gives a trackpad flick the same authority as twenty wheel notches.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode = 0): number {
  const perUnit = deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? PAGE_HEIGHT_PX : 1;
  return deltaY * perUnit;
}

/** Rough CSS pixels per line and per page, for normalising `deltaMode`. */
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 100;

/**
 * Zoom sensitivity: radius multiplier per CSS pixel of wheel travel.
 *
 * Chosen so one mouse notch (~100 px) lands near the 1.1x step the controller
 * used to apply per event, which keeps a wheel feeling the way it did while
 * making a trackpad proportional instead of explosive.
 */
const ZOOM_PER_PIXEL = 0.00095;

/** Never let one violent event cross more than this much of the range. */
const MAX_FACTOR_PER_EVENT = 2;

/**
 * How much to multiply the orbit radius by for a wheel event of `deltaPx`.
 *
 * Exponential, so zooming is geometric - the same flick covers the same
 * proportion of the range whether you are close in or far out - and so that
 * successive events compose into exactly the factor their summed delta implies.
 */
export function zoomFactor(deltaPx: number): number {
  const raw = Math.exp(deltaPx * ZOOM_PER_PIXEL);
  return Math.min(MAX_FACTOR_PER_EVENT, Math.max(1 / MAX_FACTOR_PER_EVENT, raw));
}

/**
 * One step of exponential easing from `current` towards `target`.
 *
 * Frame-rate independent: the fraction covered depends on elapsed *time*, not
 * on how many frames the machine managed, so a 144 Hz laptop and a 30 Hz one
 * settle over the same wall-clock duration. `tau` is the time constant - after
 * `tau` seconds about 63% of the distance is gone.
 */
export function dampen(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Below this the easing is done; carrying on would jitter the last pixel. */
export const SETTLE_EPSILON = 1e-4;

/**
 * World units covered by one CSS pixel of drag, at the distance of the orbit
 * target.
 *
 * This is what makes a pan track the cursor instead of sliding out from under
 * it. The viewport spans `2 * radius * tan(fov / 2)` world units vertically at
 * the target plane, over `heightPx` pixels. The controller used a hand-picked
 * constant here, which ran about 1.5x too fast at the default framing.
 */
export function panWorldPerPixel(
  radius: number,
  fovDegrees: number,
  viewportHeightPx: number,
): number {
  if (viewportHeightPx <= 0) return 0;
  const halfFov = (fovDegrees * Math.PI) / 180 / 2;
  return (2 * radius * Math.tan(halfFov)) / viewportHeightPx;
}

/**
 * Radians of orbit per CSS pixel of drag, normalised to the canvas height.
 *
 * Three's own OrbitControls uses the viewport height for both axes, so a drag
 * of the same length feels the same however wide the pane is - and dragging the
 * full height of the canvas is one full turn.
 */
export function orbitRadiansPerPixel(viewportHeightPx: number): number {
  if (viewportHeightPx <= 0) return 0;
  return (2 * Math.PI) / viewportHeightPx;
}

/**
 * Where the camera is, expressed as a point it looks at and a direction it
 * looks from. `phi` is the polar angle down from straight overhead, `theta` the
 * compass bearing around the target.
 */
export interface Orbit {
  radius: number;
  theta: number;
  phi: number;
  target: THREE.Vector3;
}

/** Just short of the poles, where the view rolls over and the controls invert. */
export const PHI_MIN = 0.12;
export const PHI_MAX = Math.PI / 2.05;

/** Place the camera on the sphere the orbit describes and aim it at the target. */
export function applyOrbit(camera: THREE.PerspectiveCamera, orbit: Orbit): void {
  const { radius, theta, phi, target } = orbit;
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
  // lookAt only sets the quaternion. Compose the matrices now so the basis
  // columns panTarget reads, and the world matrix raycasting reads, are the
  // ones this frame actually renders with - updateMatrix alone leaves
  // matrixWorld stale, which silently breaks every ray cast against it.
  camera.updateMatrixWorld(true);
}

/**
 * Slide the orbit target across the screen by a drag of `dx`, `dy` pixels.
 *
 * The basis comes from the camera's own matrix - column 0 is its right vector
 * and column 1 its up vector - so the pan is correct for any orientation with
 * no trigonometry to get wrong. The signs are what makes the model follow the
 * cursor: dragging right moves the *target* left, which carries the model
 * right, and dragging down moves the target up.
 */
export function panTarget(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  dx: number,
  dy: number,
  worldPerPixel: number,
): void {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  target.addScaledVector(right, -dx * worldPerPixel);
  target.addScaledVector(up, dy * worldPerPixel);
}

/**
 * The world point under the cursor, for zooming towards it.
 *
 * It is taken on the plane through the target facing the camera, not on the
 * ground: the ground plane is missed entirely when the camera looks at or above
 * the horizon, and a zoom that silently does nothing is worse than one that
 * zooms about a slightly different depth.
 */
export function cursorAnchor(
  camera: THREE.PerspectiveCamera,
  ndc: THREE.Vector2,
  target: THREE.Vector3,
): THREE.Vector3 {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const normal = camera.getWorldDirection(new THREE.Vector3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, target);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? target.clone();
}

/**
 * Zoom by `factor`, keeping `anchor` fixed on screen.
 *
 * Scaling both the radius and the target about the anchor scales the whole rig
 * about it: the camera ends at `anchor + factor * (camera - anchor)`, so the
 * anchor stays on the same ray out of the lens and therefore under the same
 * pixel. Zooming about the target centre instead - which is what this did - is
 * why reaching a corner meant alternating zoom and pan.
 */
export function dollyAboutPoint(orbit: Orbit, anchor: THREE.Vector3, factor: number): void {
  orbit.radius *= factor;
  orbit.target.sub(anchor).multiplyScalar(factor).add(anchor);
}
