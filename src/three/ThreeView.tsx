import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildScene, disposeScene } from './scene';
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
    const observer = new ResizeObserver(resize);
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
      dragging = e.shiftKey || e.button === 1 ? 'pan' : 'orbit';
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
      const orbit = orbitRef.current;
      if (dragging === 'orbit') {
        orbit.theta -= dx * 0.008;
        // Stop just short of the poles, where the view flips over.
        orbit.phi = Math.min(Math.PI / 2.05, Math.max(0.12, orbit.phi - dy * 0.006));
      } else {
        const scale = orbit.radius * 0.0016;
        orbit.target.x -= (dx * Math.cos(orbit.theta) - dy * Math.sin(orbit.theta)) * scale;
        orbit.target.z += (dx * Math.sin(orbit.theta) + dy * Math.cos(orbit.theta)) * scale;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = null;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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

    const element = renderer.domElement;
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

    // Frame the building the first time it has any extent.
    const size = built.bounds.getSize(new THREE.Vector3());
    const centre = built.bounds.getCenter(new THREE.Vector3());
    if (size.length() > 1) {
      orbitRef.current.target.copy(centre);
      orbitRef.current.radius = Math.max(20, size.length() * 1.1);
    }
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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <p className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-center text-xs text-slate-500">
        Drag to orbit &middot; shift-drag to pan &middot; scroll to zoom &middot; click a panel to
        select it
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
