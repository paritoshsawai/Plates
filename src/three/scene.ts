/**
 * Building the 3D scene from the 2D panel list.
 *
 * The plan is the single source of truth: this module reads panels and
 * produces meshes, and never holds state of its own. Regenerating the whole
 * scene on every change is cheap at the scale a single-storey house reaches
 * (tens to low hundreds of boxes) and removes any chance of the two views
 * drifting apart.
 *
 * Every panel is an axis-aligned box, so no extrusion and no CSG is needed.
 * An opening is not a hole cut in a wall - it *is* the panel in that slot, so
 * it is simply built as a frame instead of a solid, which is why a boolean
 * subtraction (and a WASM dependency) buys nothing here.
 */

import * as THREE from 'three';
import { AREA_DEPTH_UNITS, categoryColor, getPanelSpec } from '../core/panels';
import { detectJunctions } from '../core/junctions';
import { GRID_FT, WALL_HEIGHT_FT, unitsToFt } from '../core/units';
import type { Panel } from '../core/types';

/** Drawn wall thickness in feet. Panels are modelled with no thickness in 2D. */
export const WALL_THICKNESS_FT = 0.5;
export const SLAB_THICKNESS_FT = 0.6;

/** Height of a door head and a window sill above the floor, in feet. */
const DOOR_HEAD_FT = 7;
const WINDOW_SILL_FT = 3;
const WINDOW_HEAD_FT = 7;

export interface SceneBuild {
  group: THREE.Group;
  /** Mesh -> panel id, so a click in 3D can select in 2D. */
  pickMap: Map<THREE.Object3D, string>;
  /** Bounding box in feet, for framing the camera. */
  bounds: THREE.Box3;
}

/**
 * Plan coordinates are grid units with Y running "down" the page. Three has Y
 * up, so the plan's Y becomes Z and height takes over Y.
 */
function toFeet(units: number): number {
  return unitsToFt(units);
}

function addBox(
  parent: THREE.Group,
  material: THREE.Material,
  size: { x: number; y: number; z: number },
  centre: { x: number; y: number; z: number },
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.set(centre.x, centre.y, centre.z);
  parent.add(mesh);
  return mesh;
}

function materialFor(category: Panel['category'], opacity = 1): THREE.Material {
  return new THREE.MeshLambertMaterial({
    color: new THREE.Color(categoryColor(category)),
    transparent: opacity < 1,
    opacity,
  });
}

/** The run of a linear panel, in feet, plus where it starts. */
function linearSpan(panel: Panel) {
  const runFt = getPanelSpec(panel.size).widthFt;
  const x0 = toFeet(panel.x);
  const z0 = toFeet(panel.y);
  const horizontal = panel.orientation === 'h';
  return {
    runFt,
    centreX: horizontal ? x0 + runFt / 2 : x0,
    centreZ: horizontal ? z0 : z0 + runFt / 2,
    sizeX: horizontal ? runFt : WALL_THICKNESS_FT,
    sizeZ: horizontal ? WALL_THICKNESS_FT : runFt,
  };
}

function buildWall(group: THREE.Group, panel: Panel, pickMap: Map<THREE.Object3D, string>): void {
  const span = linearSpan(panel);
  const mesh = addBox(
    group,
    materialFor(panel.category),
    { x: span.sizeX, y: WALL_HEIGHT_FT, z: span.sizeZ },
    { x: span.centreX, y: WALL_HEIGHT_FT / 2, z: span.centreZ },
  );
  pickMap.set(mesh, panel.id);
}

/**
 * A door: the header above the opening, and nothing where the door is. The
 * opening is a whole panel slot, so leaving the gap needs no subtraction.
 *
 * The empty slot still gets an invisible box, because the doorway is where
 * anyone would click to select the door or turn it back into a wall. Without
 * it the click sails through the opening and lands on whatever stands behind,
 * so clicking "the door" a second time converted the *far* wall instead of
 * reverting this one. Zero opacity rather than `visible: false`, since the
 * raycaster must still see it, and no depth write so it cannot tint anything
 * drawn behind it.
 */
function buildDoor(group: THREE.Group, panel: Panel, pickMap: Map<THREE.Object3D, string>): void {
  const span = linearSpan(panel);
  const headerHeight = WALL_HEIGHT_FT - DOOR_HEAD_FT;
  const mesh = addBox(
    group,
    materialFor(panel.category),
    { x: span.sizeX, y: headerHeight, z: span.sizeZ },
    { x: span.centreX, y: DOOR_HEAD_FT + headerHeight / 2, z: span.centreZ },
  );
  pickMap.set(mesh, panel.id);

  const slot = addBox(
    group,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    { x: span.sizeX, y: DOOR_HEAD_FT, z: span.sizeZ },
    { x: span.centreX, y: DOOR_HEAD_FT / 2, z: span.centreZ },
  );
  pickMap.set(slot, panel.id);
}

/** A window: sill below, header above, glass between. */
function buildWindow(group: THREE.Group, panel: Panel, pickMap: Map<THREE.Object3D, string>): void {
  const span = linearSpan(panel);
  const frame = materialFor(panel.category);

  const sill = addBox(
    group,
    frame,
    { x: span.sizeX, y: WINDOW_SILL_FT, z: span.sizeZ },
    { x: span.centreX, y: WINDOW_SILL_FT / 2, z: span.centreZ },
  );
  pickMap.set(sill, panel.id);

  const headerHeight = WALL_HEIGHT_FT - WINDOW_HEAD_FT;
  const header = addBox(
    group,
    frame,
    { x: span.sizeX, y: headerHeight, z: span.sizeZ },
    { x: span.centreX, y: WINDOW_HEAD_FT + headerHeight / 2, z: span.centreZ },
  );
  pickMap.set(header, panel.id);

  const glassHeight = WINDOW_HEAD_FT - WINDOW_SILL_FT;
  const glass = new THREE.MeshLambertMaterial({
    color: new THREE.Color('#bae6fd'),
    transparent: true,
    opacity: 0.35,
  });
  // The glass is pickable too. It is the obvious place to click a window, and
  // leaving it out of the map made the middle of every window select nothing.
  const pane = addBox(
    group,
    glass,
    { x: span.sizeX * 0.9, y: glassHeight, z: span.sizeZ * 0.9 },
    { x: span.centreX, y: WINDOW_SILL_FT + glassHeight / 2, z: span.centreZ },
  );
  pickMap.set(pane, panel.id);
}

/** A floor or roof panel: a flat slab covering the cells it owns. */
function buildSlab(group: THREE.Group, panel: Panel, pickMap: Map<THREE.Object3D, string>): void {
  const spec = getPanelSpec(panel.size);
  const widthUnits = panel.orientation === 'h' ? spec.widthUnits : AREA_DEPTH_UNITS;
  const depthUnits = panel.orientation === 'h' ? AREA_DEPTH_UNITS : spec.widthUnits;

  const sizeX = toFeet(widthUnits);
  const sizeZ = toFeet(depthUnits);
  const y = panel.category === 'roof' ? WALL_HEIGHT_FT + SLAB_THICKNESS_FT / 2 : -SLAB_THICKNESS_FT / 2;

  const mesh = addBox(
    group,
    materialFor(panel.category, panel.category === 'roof' ? 0.75 : 1),
    { x: sizeX, y: SLAB_THICKNESS_FT, z: sizeZ },
    { x: toFeet(panel.x) + sizeX / 2, y, z: toFeet(panel.y) + sizeZ / 2 },
  );
  pickMap.set(mesh, panel.id);
}

/** Junction hardware, shown as the posts they really are. */
function buildConnectors(group: THREE.Group, panels: Panel[]): void {
  const material = new THREE.MeshLambertMaterial({ color: new THREE.Color('#475569') });
  const post = WALL_THICKNESS_FT * 1.6;
  for (const junction of detectJunctions(panels)) {
    addBox(
      group,
      material,
      { x: post, y: WALL_HEIGHT_FT, z: post },
      { x: toFeet(junction.at.x), y: WALL_HEIGHT_FT / 2, z: toFeet(junction.at.y) },
    );
  }
}

/** Build the whole model. The caller owns disposing of the returned group. */
export function buildScene(panels: Panel[]): SceneBuild {
  const group = new THREE.Group();
  const pickMap = new Map<THREE.Object3D, string>();

  for (const panel of panels) {
    switch (panel.category) {
      case 'wall':
        buildWall(group, panel, pickMap);
        break;
      case 'door':
        buildDoor(group, panel, pickMap);
        break;
      case 'window':
        buildWindow(group, panel, pickMap);
        break;
      case 'floor':
      case 'roof':
        buildSlab(group, panel, pickMap);
        break;
    }
  }

  buildConnectors(group, panels);

  const bounds = new THREE.Box3().setFromObject(group);
  if (bounds.isEmpty()) {
    bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(GRID_FT, GRID_FT, GRID_FT));
  }

  return { group, pickMap, bounds };
}

/**
 * How far a camera must sit from a bounding sphere of `sphereRadius` to hold
 * the whole thing in frame.
 *
 * Distance has to satisfy the *tighter* of the two fields of view. A wide,
 * short pane is limited by its vertical FOV; a tall, narrow one by the
 * horizontal FOV the aspect ratio implies. Solving only the vertical one - or
 * worse, using the bounding box diagonal as a distance, as this did before -
 * clips a wide building the moment the pane is not square.
 */
export function fitRadius(
  sphereRadius: number,
  fovDegrees: number,
  aspect: number,
  margin = 1.25,
): number {
  const safeRadius = Math.max(sphereRadius, 0.5);
  const vertical = (fovDegrees * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(aspect, 0.01));
  const forVertical = safeRadius / Math.sin(vertical / 2);
  const forHorizontal = safeRadius / Math.sin(horizontal / 2);
  return Math.max(forVertical, forHorizontal) * margin;
}

/** Bounding sphere of a build, for framing. */
export function boundingSphere(bounds: THREE.Box3): { centre: THREE.Vector3; radius: number } {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  return { centre: sphere.center.clone(), radius: sphere.radius };
}

/** Free every geometry and material a build allocated. */
export function disposeScene(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose?.();
  });
}
