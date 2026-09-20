import { describe, expect, it } from 'vitest';
import type { BoxGeometry, Mesh } from 'three';
import { SLAB_THICKNESS_FT, buildScene, disposeScene } from '../scene';
import { WALL_HEIGHT_FT } from '../../core/units';
import type { Panel } from '../../core/types';

const wall = (over: Partial<Panel> = {}): Panel => ({
  id: 'w',
  category: 'wall',
  size: '4x10',
  x: 0,
  y: 0,
  orientation: 'h',
  ...over,
});

/** Every mesh in a build, with its size and centre, for asserting geometry. */
function meshes(panels: Panel[]) {
  const { group } = buildScene(panels);
  return group.children.map((child) => {
    const mesh = child as Mesh;
    const params = (mesh.geometry as BoxGeometry).parameters;
    return {
      size: { x: params.width, y: params.height, z: params.depth },
      at: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    };
  });
}

describe('buildScene coordinate mapping', () => {
  it('maps grid units to feet, with the plan Y becoming Z', () => {
    // A 4 ft panel at grid (3, 2) starts at 6 ft, 4 ft in plan.
    const [box] = meshes([wall({ x: 3, y: 2 })]);
    expect(box.size.x).toBe(4);
    expect(box.at.x).toBe(6 + 2); // origin plus half the 4 ft run
    expect(box.at.z).toBe(4);
  });

  it('stands a wall up to its full height, centred on half of it', () => {
    const [box] = meshes([wall()]);
    expect(box.size.y).toBe(WALL_HEIGHT_FT);
    expect(box.at.y).toBe(WALL_HEIGHT_FT / 2);
  });

  it('turns a vertical panel along Z rather than X', () => {
    const [box] = meshes([wall({ orientation: 'v' })]);
    expect(box.size.z).toBe(4);
    expect(box.size.x).toBeLessThan(1); // thickness only
  });

  it('sizes a 2 ft panel at 2 ft', () => {
    expect(meshes([wall({ size: '2x10' })])[0].size.x).toBe(2);
  });
});

describe('openings are built, not subtracted', () => {
  it('gives a door only a header, leaving the opening empty', () => {
    const built = meshes([wall({ category: 'door' })]);
    expect(built).toHaveLength(1);
    // 10 ft wall less a 7 ft door head.
    expect(built[0].size.y).toBe(3);
    expect(built[0].at.y).toBe(7 + 1.5);
  });

  it('gives a window a sill, a header and glass between', () => {
    const built = meshes([wall({ category: 'window' })]);
    expect(built).toHaveLength(3);
    const heights = built.map((b) => b.size.y).sort((a, b) => a - b);
    expect(heights).toEqual([3, 3, 4]); // header 3, sill 3, glass 4
  });
});

describe('area panels become slabs', () => {
  it('puts a floor just below ground and a roof above the wall top', () => {
    const floor = meshes([wall({ category: 'floor' })])[0];
    const roof = meshes([wall({ category: 'roof' })])[0];
    expect(floor.at.y).toBe(-SLAB_THICKNESS_FT / 2);
    expect(roof.at.y).toBe(WALL_HEIGHT_FT + SLAB_THICKNESS_FT / 2);
  });

  it('spans the panel 4 ft one way and its full 10 ft depth the other', () => {
    const slab = meshes([wall({ category: 'floor' })])[0];
    expect(slab.size.x).toBe(4);
    expect(slab.size.z).toBe(10);
  });

  it('swaps those for a vertical slab', () => {
    const slab = meshes([wall({ category: 'floor', orientation: 'v' })])[0];
    expect(slab.size.x).toBe(10);
    expect(slab.size.z).toBe(4);
  });
});

describe('the scene as a whole', () => {
  it('maps every pickable mesh back to its panel', () => {
    const panels = [wall({ id: 'a' }), wall({ id: 'b', x: 2 })];
    const { pickMap } = buildScene(panels);
    expect(new Set(pickMap.values())).toEqual(new Set(['a', 'b']));
  });

  it('adds a post at each detected junction', () => {
    // A closed 8 x 8 ft room: four corners, so four posts beyond the walls.
    const room: Panel[] = [
      wall({ id: 't', x: 0, y: 0, orientation: 'h' }),
      wall({ id: 'b2', x: 0, y: 2, orientation: 'h' }),
      wall({ id: 'l', x: 0, y: 0, orientation: 'v' }),
      wall({ id: 'r', x: 2, y: 0, orientation: 'v' }),
    ];
    const { group } = buildScene(room);
    expect(group.children).toHaveLength(4 + 4);
  });

  it('never returns an empty bounding box, which would break camera framing', () => {
    expect(buildScene([]).bounds.isEmpty()).toBe(false);
  });

  it('disposes cleanly', () => {
    const { group } = buildScene([wall()]);
    expect(() => disposeScene(group)).not.toThrow();
  });
});
