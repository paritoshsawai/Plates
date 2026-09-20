import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { boundingSphere, buildScene, disposeScene, fitRadius } from './scene';
import {
  PHI_MAX,
  PHI_MIN,
  SETTLE_EPSILON,
  applyOrbit,
  cursorAnchor,
  dampen,
  dollyAboutPoint,
  normalizeWheelDelta,
  orbitRadiansPerPixel,
  panTarget,
  panWorldPerPixel,
  zoomFactor,
} from './controls';
import type { Orbit } from './controls';
import { useStore } from '../state/store';
import type { Panel } from '../core/types';

/**
 * A minimal orbit camera.
 *
 * drei's OrbitControls would arrive with react-three-fiber, which currently
 * pins React below the version this app runs on and pulls an Expo peer tree
 * behind it. The rig itself lives in `controls.ts`, where it is unit-tested
 * without a canvas; this file is the glue between pointer events and that rig.
 *
 * Input writes the *desired* orbit and the render loop eases the *current* one
 * towards it, which is what makes a drag glide rather than step. When the two
 * agree the loop stops drawing until something changes again.
 */

/** Easing time constant, in seconds. Long enough to smooth, short enough not to lag. */
const SMOOTHING_TAU = 0.07;

const FOV_DEGREES = 50;

function cloneOrbit(orbit: Orbit): Orbit {
  return { ...orbit, target: orbit.target.clone() };
}

export default function ThreeView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const panels = useStore((s) => s.plan.panels);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);

  // Kept in refs so the render loop is set up once and never torn down by a
  // panel edit; only the model group is swapped.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const pickRef = useRef<Map<THREE.Object3D, string>>(new Map());
  // Set once the user moves the camera, so an automatic re-fit never yanks the
  // view out from under them.
  const touchedRef = useRef(false);
  const fitRef = useRef<(() => void) | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);

  const desiredRef = useRef<Orbit>({
    radius: 80,
    theta: Math.PI * 0.75,
    phi: Math.PI * 0.35,
    target: new THREE.Vector3(),
  });
  const currentRef = useRef<Orbit>(cloneOrbit(desiredRef.current));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f1f5f9');
    sceneRef.current = scene;

    scene.add(new THREE.AmbientLight('#ffffff', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.9);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    const ground = new THREE.GridHelper(400, 200, '#cbd5e1', '#e2e8f0');
    ground.position.y = -0.05;
    scene.add(ground);

    const camera = new THREE.PerspectiveCamera(FOV_DEGREES, 1, 0.5, 4000);
    // A second camera parked at the *desired* orbit. Pan and zoom read their
    // basis and their cursor ray from this rather than from the on-screen
    // camera, so repeated input while the easing is still settling composes
    // exactly instead of drifting.
    const aim = new THREE.PerspectiveCamera(FOV_DEGREES, 1, 0.5, 4000);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      container.textContent = 'This browser cannot render 3D (WebGL is unavailable).';
      return;
    }
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    /** Ask for a frame. Everything that changes what is on screen calls this. */
    let dirty = true;
    const invalidate = () => {
      dirty = true;
    };
    invalidateRef.current = invalidate;

    let viewportHeightPx = 1;

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      viewportHeightPx = clientHeight;
      // setPixelRatio before setSize: it re-runs setSize itself with
      // updateStyle off, so it has to go first or it would undo the CSS size.
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      // updateStyle is left at its default of true on purpose. With it off,
      // three sets the canvas's pixel dimensions - which it multiplies by the
      // pixel ratio - but never its CSS size, so on any HiDPI display the
      // canvas lays out at twice its container and most of the render ends up
      // off-screen. That was the long-standing "cannot see the whole plan" bug.
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      aim.aspect = camera.aspect;
      aim.updateProjectionMatrix();
      invalidate();
    };
    const observer = new ResizeObserver(() => {
      resize();
      // A radius that framed a wide pane clips a narrow one, so re-fit unless
      // the user has taken the camera somewhere themselves.
      if (!touchedRef.current) fitRef.current?.();
    });
    observer.observe(container);
    resize();

    /** Park the scratch camera at the orbit the user is heading towards. */
    const syncAim = () => {
      applyOrbit(aim, desiredRef.current);
      return aim;
    };

    // How close you may get and how far you may back off. Derived from the
    // model in fit(), so a small building can be inspected up close and a
    // large one can still be seen whole.
    let minRadius = 2;
    let maxRadius = 600;
    const clampRadius = (r: number) => Math.min(maxRadius, Math.max(minRadius, r));

    // Orbit, pan and zoom.
    let dragging: 'orbit' | 'pan' | null = null;
    let activePointer: number | null = null;
    let lastX = 0;
    let lastY = 0;
    // How far the pointer travelled since it went down. Orbiting ends with a
    // click event too, so without this every camera move would also select
    // whatever happened to be under the cursor when you let go.
    let travelled = 0;
    const CLICK_SLOP_PX = 5;

    const endDrag = () => {
      if (activePointer !== null) {
        try {
          renderer.domElement.releasePointerCapture(activePointer);
        } catch {
          // The pointer is already gone; nothing to release.
        }
      }
      dragging = null;
      activePointer = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      // Right and middle button pan, as in every CAD tool; shift-drag does too,
      // for trackpads with no second button.
      const mode = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit';
      // Keeps a drag from also starting a text selection on the page, which
      // leaves the cursor stuck in an I-beam and the drag feeling gritty.
      e.preventDefault();
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
        activePointer = e.pointerId;
      } catch {
        // Capture can be refused if the pointer has already been released. In
        // that case do not start a drag at all: without capture the matching
        // pointerup may never arrive and the camera would follow the bare
        // mouse with no button held.
        return;
      }
      dragging = mode;
      lastX = e.clientX;
      lastY = e.clientY;
      travelled = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      // A release the page never saw - an alt-tab mid-drag, a devtools break -
      // leaves no button down. Treat that as the end of the drag.
      if (e.buttons === 0) {
        endDrag();
        return;
      }

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled > CLICK_SLOP_PX) touchedRef.current = true;

      const desired = desiredRef.current;
      if (dragging === 'orbit') {
        const perPixel = orbitRadiansPerPixel(viewportHeightPx);
        desired.theta -= dx * perPixel;
        // Stop just short of the poles, where the view flips over.
        desired.phi = Math.min(PHI_MAX, Math.max(PHI_MIN, desired.phi - dy * perPixel));
      } else {
        panTarget(
          syncAim(),
          desired.target,
          dx,
          dy,
          panWorldPerPixel(desired.radius, FOV_DEGREES, viewportHeightPx),
        );
      }
      invalidate();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touchedRef.current = true;

      const desired = desiredRef.current;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      // Proportional to how far the wheel actually turned, so a trackpad's
      // stream of tiny events is a gentle zoom rather than twenty full steps.
      const factor = zoomFactor(normalizeWheelDelta(e.deltaY, e.deltaMode));
      const clamped = clampRadius(desired.radius * factor) / desired.radius;
      dollyAboutPoint(desired, cursorAnchor(syncAim(), ndc, desired.target), clamped);
      invalidate();
    };

    // Clicking a mesh selects the panel it came from, in both views.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      if (travelled > CLICK_SLOP_PX) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const model = modelRef.current;
      if (!model) return;
      const hit = raycaster.intersectObjects(model.children, false)[0];
      const id = hit ? pickRef.current.get(hit.object) : undefined;
      select(id ? [id] : []);
    };

    // Without this the right button opens the browser menu mid-pan.
    const onContextMenu = (e: Event) => e.preventDefault();

    /**
     * Frame the whole model. Re-derived from the live aspect ratio, so a fit
     * that suited a wide pane is recomputed when the pane turns narrow.
     */
    const fit = () => {
      const model = modelRef.current;
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return;
      const sphere = boundingSphere(box);
      minRadius = Math.max(1, sphere.radius * 0.08);
      maxRadius = Math.max(200, sphere.radius * 12);
      const desired = desiredRef.current;
      desired.target.copy(sphere.centre);
      desired.radius = clampRadius(fitRadius(sphere.radius, camera.fov, camera.aspect));
      invalidate();
    };
    fitRef.current = fit;

    const element = renderer.domElement;
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('lostpointercapture', endDrag);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('click', onClick);

    /** Ease `current` towards `desired`; report whether anything still moves. */
    const settle = (dt: number): boolean => {
      const desired = desiredRef.current;
      const current = currentRef.current;
      const scale = Math.max(1, desired.radius);

      const moved =
        Math.abs(desired.radius - current.radius) / scale > SETTLE_EPSILON ||
        Math.abs(desired.theta - current.theta) > SETTLE_EPSILON ||
        Math.abs(desired.phi - current.phi) > SETTLE_EPSILON ||
        desired.target.distanceTo(current.target) / scale > SETTLE_EPSILON;

      if (!moved) {
        // Snap, so the two never sit a hair apart and re-trigger forever.
        current.radius = desired.radius;
        current.theta = desired.theta;
        current.phi = desired.phi;
        current.target.copy(desired.target);
        return false;
      }

      current.radius = dampen(current.radius, desired.radius, dt, SMOOTHING_TAU);
      current.theta = dampen(current.theta, desired.theta, dt, SMOOTHING_TAU);
      current.phi = dampen(current.phi, desired.phi, dt, SMOOTHING_TAU);
      current.target.set(
        dampen(current.target.x, desired.target.x, dt, SMOOTHING_TAU),
        dampen(current.target.y, desired.target.y, dt, SMOOTHING_TAU),
        dampen(current.target.z, desired.target.z, dt, SMOOTHING_TAU),
      );
      return true;
    };

    let frame = 0;
    let lastTime = performance.now();
    const tick = (now: number) => {
      // Cap dt so a backgrounded tab does not resume with one enormous step.
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const moving = settle(dt);
      if (moving || dirty) {
        dirty = false;
        applyOrbit(camera, currentRef.current);
        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('lostpointercapture', endDrag);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('click', onClick);
      element.removeEventListener('contextmenu', onContextMenu);
      fitRef.current = null;
      invalidateRef.current = null;
      if (modelRef.current) disposeScene(modelRef.current);
      renderer.dispose();
      element.remove();
    };
  }, [select]);

  // Rebuild the model whenever the plan changes. The 2D panel list is the only
  // source of truth; nothing about the model is edited in place.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeScene(modelRef.current);
    }

    const built = buildScene(panels);
    scene.add(built.group);
    modelRef.current = built.group;
    pickRef.current = built.pickMap;

    // Frame it, unless the user has already moved the camera themselves.
    if (!touchedRef.current) fitRef.current?.();
    invalidateRef.current?.();
  }, [panels]);

  // Highlight the selected panels by brightening their material.
  useEffect(() => {
    const selected = new Set(selection);
    for (const [object, id] of pickRef.current) {
      const mesh = object as THREE.Mesh;
      const material = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (!material?.emissive) continue;
      material.emissive.set(selected.has(id) ? '#f59e0b' : '#000000');
      material.emissiveIntensity = selected.has(id) ? 0.55 : 0;
    }
    invalidateRef.current?.();
  }, [selection, panels]);

  /** Point the camera from a fixed direction, then re-fit. */
  const setView = (theta: number, phi: number) => {
    desiredRef.current.theta = theta;
    desiredRef.current.phi = phi;
    touchedRef.current = false;
    fitRef.current?.();
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full overflow-hidden" />

      <div className="absolute right-3 top-3 flex gap-1.5">
        {([
          ['Fit', null],
          ['Top', [Math.PI, PHI_MIN]],
          ['Front', [Math.PI, PHI_MAX]],
          ['Iso', [Math.PI * 0.75, Math.PI * 0.35]],
        ] as const).map(([label, angles]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (angles) setView(angles[0], angles[1]);
              else {
                touchedRef.current = false;
                fitRef.current?.();
              }
            }}
            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {label}
          </button>
        ))}
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-center text-xs text-slate-500">
        Drag to orbit &middot; right-drag, middle-drag or shift-drag to pan &middot; scroll to zoom
        at the cursor &middot; click a panel to select it
      </p>
      {panels.length === 0 && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          Draw some walls in the plan view and they will appear here.
        </p>
      )}
    </div>
  );
}

/** Re-exported so the tab can name the type without importing three. */
export type { Panel };
