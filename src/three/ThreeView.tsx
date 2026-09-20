import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { boundingSphere, buildScene, disposeScene, fitRadius } from './scene';
import { useStore } from '../state/store';
import type { Panel } from '../core/types';

/**
 * A minimal orbit camera.
 *
 * drei's OrbitControls would arrive with react-three-fiber, which currently
 * pins React below the version this app runs on and pulls an Expo peer tree
 * behind it. Orbiting a fixed target is a few lines of spherical coordinates,
 * so the dependency is not worth taking for it.
 */
interface Orbit {
  radius: number;
  theta: number;
  phi: number;
  target: THREE.Vector3;
}

function applyOrbit(camera: THREE.PerspectiveCamera, orbit: Orbit): void {
  const { radius, theta, phi, target } = orbit;
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
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
  const orbitRef = useRef<Orbit>({
    radius: 80,
    theta: Math.PI * 0.75,
    phi: Math.PI * 0.35,
    target: new THREE.Vector3(),
  });

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

    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      container.textContent = 'This browser cannot render 3D (WebGL is unavailable).';
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(() => {
      resize();
      // A radius that framed a wide pane clips a narrow one, so re-fit unless
      // the user has taken the camera somewhere themselves.
      if (!touchedRef.current) fitRef.current?.();
    });
    observer.observe(container);
    resize();

    // Orbit, pan and zoom.
    let dragging: 'orbit' | 'pan' | null = null;
    let lastX = 0;
    let lastY = 0;
    // How far the pointer travelled since it went down. Orbiting ends with a
    // click event too, so without this every camera move would also select
    // whatever happened to be under the cursor when you let go.
    let travelled = 0;
    const CLICK_SLOP_PX = 5;

    const onPointerDown = (e: PointerEvent) => {
      // Right and middle button pan, as in every CAD tool; shift-drag does too,
      // for trackpads with no second button.
      dragging = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit';
      lastX = e.clientX;
      lastY = e.clientY;
      travelled = 0;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled > CLICK_SLOP_PX) touchedRef.current = true;
      const orbit = orbitRef.current;
      if (dragging === 'orbit') {
        orbit.theta -= dx * 0.008;
        // Stop just short of the poles, where the view flips over.
        orbit.phi = Math.min(Math.PI / 2.05, Math.max(0.12, orbit.phi - dy * 0.006));
      } else {
        // Pan across the screen, not the world: horizontal drag slides along
        // the camera's right vector, vertical drag lifts the target as well as
        // sliding it, so a tall building can be raised into frame.
        const scale = orbit.radius * 0.0016;
        const cos = Math.cos(orbit.theta);
        const sin = Math.sin(orbit.theta);
        orbit.target.x -= dx * cos * scale - dy * Math.cos(orbit.phi) * sin * scale;
        orbit.target.z += dx * sin * scale + dy * Math.cos(orbit.phi) * cos * scale;
        orbit.target.y += dy * Math.sin(orbit.phi) * scale;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = null;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touchedRef.current = true;
      const orbit = orbitRef.current;
      orbit.radius = Math.min(600, Math.max(6, orbit.radius * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
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
      orbitRef.current.target.copy(sphere.centre);
      orbitRef.current.radius = fitRadius(sphere.radius, camera.fov, camera.aspect);
    };
    fitRef.current = fit;

    const element = renderer.domElement;
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('click', onClick);

    let frame = 0;
    const tick = () => {
      applyOrbit(camera, orbitRef.current);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('click', onClick);
      element.removeEventListener('contextmenu', onContextMenu);
      fitRef.current = null;
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
  }, [selection, panels]);

  /** Point the camera from a fixed direction, then re-fit. */
  const setView = (theta: number, phi: number) => {
    orbitRef.current.theta = theta;
    orbitRef.current.phi = phi;
    touchedRef.current = false;
    fitRef.current?.();
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute right-3 top-3 flex gap-1.5">
        {([
          ['Fit', null],
          ['Top', [Math.PI, 0.13]],
          ['Front', [Math.PI, Math.PI / 2.05]],
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
        Drag to orbit &middot; right-drag or shift-drag to pan &middot; scroll to zoom &middot;
        click a panel to select it
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
