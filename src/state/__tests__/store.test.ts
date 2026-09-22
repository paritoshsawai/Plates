import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { buildEdgeIndex } from '../../core/walls';
import { edgeKey, panelEdges } from '../../core/panels';
import { rectPlotFromFt } from '../../core/plot';
import { tileRun } from '../../core/tiling';
import type { Panel, PanelCategory } from '../../core/types';

/** Grid edges a set of panels covers, as a comparable sorted list. */
function coverage(panels: Panel[]): string[] {
  return panels.flatMap((p) => panelEdges(p).map(edgeKey)).sort();
}

function seed(panels: Panel[]) {
  useStore.setState((state) => ({
    plan: { ...state.plan, panels },
    past: [],
    future: [],
    selection: [],
  }));
}

const panels = () => useStore.getState().plan.panels;

describe('setPanelCategory', () => {
  beforeEach(() => {
    seed([{ id: 'a', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h' }]);
  });

  it('converts in place, keeping size, position and orientation', () => {
    useStore.getState().setPanelCategory('a', 'door');
    expect(panels()[0]).toMatchObject({
      id: 'a',
      category: 'door',
      size: '4x10',
      x: 0,
      y: 0,
      orientation: 'h',
    });
  });

  it('covers exactly the same wall, so the run is never broken', () => {
    const before = coverage(panels());
    useStore.getState().setPanelCategory('a', 'window');
    expect(coverage(panels())).toEqual(before);
  });

  it('drops stale swing detail when an opening becomes a wall again', () => {
    useStore.getState().setPanelCategory('a', 'door');
    useStore.setState((s) => ({
      plan: {
        ...s.plan,
        panels: s.plan.panels.map((p) => ({ ...p, opening: { swing: 'right' as const } })),
      },
    }));
    useStore.getState().setPanelCategory('a', 'wall');
    expect(panels()[0].opening).toBeUndefined();
  });

  it('is undoable', () => {
    useStore.getState().setPanelCategory('a', 'door');
    useStore.getState().undo();
    expect(panels()[0].category).toBe('wall');
  });

  it('does nothing when the category already matches', () => {
    const past = useStore.getState().past.length;
    useStore.getState().setPanelCategory('a', 'wall');
    expect(useStore.getState().past.length).toBe(past);
  });

  it('ignores an id that is not in the plan', () => {
    useStore.getState().setPanelCategory('nope', 'door');
    expect(panels()[0].category).toBe('wall');
  });
});

describe('splitPanel', () => {
  it('replaces a 4 ft panel with two 2 ft panels covering the same edges', () => {
    seed([{ id: 'a', category: 'wall', size: '4x10', x: 3, y: 1, orientation: 'h' }]);
    const before = coverage(panels());

    useStore.getState().splitPanel('a');

    expect(panels()).toHaveLength(2);
    expect(panels().every((p) => p.size === '2x10')).toBe(true);
    expect(coverage(panels())).toEqual(before);
    // No overlap: two distinct edges, not the same one twice.
    expect(buildEdgeIndex(panels()).edges.size).toBe(2);
  });

  it('lays the halves along the run for a vertical panel too', () => {
    seed([{ id: 'a', category: 'wall', size: '4x10', x: 3, y: 1, orientation: 'v' }]);
    useStore.getState().splitPanel('a');
    expect(panels().map((p) => [p.x, p.y])).toEqual([
      [3, 1],
      [3, 2],
    ]);
  });

  it('carries the category across, so a door run stays a door run', () => {
    seed([{ id: 'a', category: 'door', size: '4x10', x: 0, y: 0, orientation: 'h' }]);
    useStore.getState().splitPanel('a');
    expect(panels().every((p) => p.category === 'door')).toBe(true);
  });

  it('gives the halves fresh ids', () => {
    seed([{ id: 'a', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h' }]);
    useStore.getState().splitPanel('a');
    const ids = panels().map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('a');
  });

  it('refuses to split a 2 ft panel, which has nothing to split into', () => {
    seed([{ id: 'a', category: 'wall', size: '2x10', x: 0, y: 0, orientation: 'h' }]);
    useStore.getState().splitPanel('a');
    expect(panels()).toHaveLength(1);
    expect(panels()[0].id).toBe('a');
  });

  it('is undoable', () => {
    seed([{ id: 'a', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h' }]);
    useStore.getState().splitPanel('a');
    useStore.getState().undo();
    expect(panels()).toHaveLength(1);
    expect(panels()[0].size).toBe('4x10');
  });
});

describe('nudgeSelection', () => {
  /** Reseed with a plot big enough that only the explicit cases hit its edge. */
  function seedIn(panels: Panel[], widthFt: number, lengthFt: number, selection: string[] = []) {
    useStore.setState((state) => ({
      plan: { ...state.plan, panels, plot: rectPlotFromFt(widthFt, lengthFt) },
      past: [],
      future: [],
      selection,
      message: null,
    }));
  }

  const wall = (over: Partial<Panel>): Panel => ({
    id: 'a',
    category: 'wall',
    size: '4x10',
    x: 2,
    y: 2,
    orientation: 'h',
    ...over,
  });

  it('moves the selection one 2 ft step', () => {
    seedIn([wall({})], 40, 40, ['a']);
    useStore.getState().nudgeSelection(1, 0);
    expect(panels()[0]).toMatchObject({ x: 3, y: 2 });
  });

  it('moves every selected panel together', () => {
    seedIn([wall({}), wall({ id: 'b', x: 4 })], 40, 40, ['a', 'b']);
    useStore.getState().nudgeSelection(0, 1);
    expect(panels().map((p) => [p.x, p.y])).toEqual([
      [2, 3],
      [4, 3],
    ]);
  });

  it('leaves unselected panels alone', () => {
    seedIn([wall({}), wall({ id: 'b', x: 8 })], 40, 40, ['a']);
    useStore.getState().nudgeSelection(1, 0);
    expect(panels()[1]).toMatchObject({ x: 8, y: 2 });
  });

  it('refuses a move that would land on another panel', () => {
    seedIn([wall({}), wall({ id: 'b', x: 4 })], 40, 40, ['a']);
    useStore.getState().nudgeSelection(1, 0);
    expect(panels()[0]).toMatchObject({ x: 2, y: 2 });
    expect(useStore.getState().message?.tone).toBe('error');
  });

  it('refuses a move that would leave the plot', () => {
    // A 10 x 10 ft plot is 5 x 5 units; the panel already ends at its edge.
    seedIn([wall({ x: 3, y: 0 })], 10, 10, ['a']);
    useStore.getState().nudgeSelection(1, 0);
    expect(panels()[0]).toMatchObject({ x: 3, y: 0 });
  });

  it('lets a run slide along itself without colliding with its own tail', () => {
    seedIn([wall({}), wall({ id: 'b', x: 4 })], 40, 40, ['a', 'b']);
    useStore.getState().nudgeSelection(1, 0);
    expect(panels().map((p) => p.x)).toEqual([3, 5]);
  });

  it('refuses the whole move when one panel of the selection cannot make it', () => {
    // 'b' is free to move; 'a' would run into 'blocker'. Neither moves.
    seedIn(
      [wall({}), wall({ id: 'b', x: 20 }), wall({ id: 'blocker', x: 4 })],
      60,
      40,
      ['a', 'b'],
    );
    useStore.getState().nudgeSelection(1, 0);
    expect(panels().map((p) => p.x)).toEqual([2, 20, 4]);
  });

  it('keeps a floor on its own plane, so a roof above it is not a collision', () => {
    seedIn(
      [
        { id: 'f', category: 'floor', size: '4x10', x: 0, y: 0, orientation: 'h' },
        { id: 'r', category: 'roof', size: '4x10', x: 1, y: 0, orientation: 'h' },
      ],
      40,
      40,
      ['f'],
    );
    useStore.getState().nudgeSelection(1, 0);
    expect(panels()[0]).toMatchObject({ x: 1, y: 0 });
  });

  it('does nothing without a selection', () => {
    seedIn([wall({})], 40, 40, []);
    useStore.getState().nudgeSelection(1, 0);
    expect(panels()[0]).toMatchObject({ x: 2, y: 2 });
  });

  it('is undoable as one step', () => {
    seedIn([wall({}), wall({ id: 'b', x: 4 })], 40, 40, ['a', 'b']);
    useStore.getState().nudgeSelection(0, 1);
    useStore.getState().undo();
    expect(panels().map((p) => p.y)).toEqual([2, 2]);
  });
});

describe('fillArea strip direction', () => {
  /** A closed rectangular room, in feet, anchored at the origin. */
  function room(widthFt: number, depthFt: number): Panel[] {
    const w = widthFt / 2;
    const d = depthFt / 2;
    return [
      ...tileRun(0, 0, w, 'h')!,
      ...tileRun(0, d, w, 'h')!,
      ...tileRun(0, 0, d, 'v')!,
      ...tileRun(w, 0, d, 'v')!,
    ];
  }

  function seedRoom(widthFt: number, depthFt: number) {
    useStore.setState((state) => ({
      plan: { ...state.plan, panels: room(widthFt, depthFt), plot: rectPlotFromFt(80, 80) },
      past: [],
      future: [],
      selection: [],
      areaAxis: {},
      message: null,
    }));
  }

  const floors = () => panels().filter((p) => p.category === 'floor');
  const axis = () => useStore.getState().areaAxis.floor;

  it('records the direction an automatic fill chose', () => {
    seedRoom(20, 20);
    useStore.getState().fillArea('floor');
    expect(floors().length).toBeGreaterThan(0);
    expect(axis()).toBeDefined();
  });

  it('lays the strips the way it is asked to', () => {
    seedRoom(20, 20);
    useStore.getState().fillArea('floor', 'v');
    expect(axis()).toBe('v');
    expect(floors().every((p) => p.orientation === 'v')).toBe(true);

    useStore.getState().fillArea('floor', 'h');
    expect(axis()).toBe('h');
    expect(floors().every((p) => p.orientation === 'h')).toBe(true);
  });

  it('covers a square room equally well either way', () => {
    // 20 x 20 ft is two 10 ft strips whichever way they run, so flipping must
    // not cost panels - it is purely the architect's choice.
    seedRoom(20, 20);
    useStore.getState().fillArea('floor', 'h');
    const across = floors().length;
    useStore.getState().fillArea('floor', 'v');
    expect(floors().length).toBe(across);
  });

  it('replaces rather than stacks, so flipping never doubles the floor', () => {
    seedRoom(20, 20);
    useStore.getState().fillArea('floor', 'h');
    const first = floors().length;
    useStore.getState().fillArea('floor', 'v');
    useStore.getState().fillArea('floor', 'h');
    expect(floors().length).toBe(first);
  });

  it('leaves the other category alone', () => {
    seedRoom(20, 20);
    useStore.getState().fillArea('roof');
    const roofs = panels().filter((p) => p.category === 'roof').length;
    useStore.getState().fillArea('floor', 'v');
    expect(panels().filter((p) => p.category === 'roof')).toHaveLength(roofs);
  });
});

describe('setAreaAxis', () => {
  function seedRoom() {
    const panelsIn = [
      ...tileRun(0, 0, 10, 'h')!,
      ...tileRun(0, 10, 10, 'h')!,
      ...tileRun(0, 0, 10, 'v')!,
      ...tileRun(10, 0, 10, 'v')!,
    ];
    useStore.setState((state) => ({
      plan: { ...state.plan, panels: panelsIn, plot: rectPlotFromFt(80, 80) },
      past: [],
      future: [],
      selection: [],
      areaAxis: {},
      message: null,
    }));
  }

  it('re-lays an existing floor immediately', () => {
    seedRoom();
    useStore.getState().fillArea('floor', 'h');
    useStore.getState().setAreaAxis('floor', 'v');
    expect(useStore.getState().areaAxis.floor).toBe('v');
    expect(panels().filter((p) => p.category === 'floor').every((p) => p.orientation === 'v')).toBe(
      true,
    );
  });

  it('just remembers the choice when nothing is laid yet', () => {
    seedRoom();
    useStore.getState().setAreaAxis('floor', 'v');
    expect(useStore.getState().areaAxis.floor).toBe('v');
    expect(panels().filter((p) => p.category === 'floor')).toHaveLength(0);
  });

  it('does nothing when the direction is already the current one', () => {
    seedRoom();
    useStore.getState().fillArea('floor', 'h');
    const before = panels().filter((p) => p.category === 'floor').map((p) => p.id);
    useStore.getState().setAreaAxis('floor', 'h');
    expect(panels().filter((p) => p.category === 'floor').map((p) => p.id)).toEqual(before);
  });
});

describe('movePanel', () => {
  const floor = (over: Partial<Panel>): Panel => ({
    id: 'f',
    category: 'floor',
    size: '4x10',
    x: 0,
    y: 0,
    orientation: 'h',
    ...over,
  });

  function seedIn(panelsIn: Panel[]) {
    useStore.setState((state) => ({
      plan: { ...state.plan, panels: panelsIn, plot: rectPlotFromFt(80, 80) },
      past: [],
      future: [],
      selection: [],
      message: null,
    }));
  }

  it('moves an area panel to clear ground', () => {
    seedIn([floor({})]);
    useStore.getState().movePanel('f', 6, 0);
    expect(panels()[0]).toMatchObject({ x: 6, y: 0 });
  });

  it('refuses to drop an area panel on another of its own kind', () => {
    // A floor panel is 2 x 5 cells, so x=0 and x=1 overlap.
    seedIn([floor({}), floor({ id: 'g', x: 4 })]);
    useStore.getState().movePanel('f', 3, 0);
    expect(panels()[0]).toMatchObject({ x: 0, y: 0 });
    expect(useStore.getState().message?.tone).toBe('error');
  });

  it('refuses to drop an area panel outside the plot', () => {
    useStore.setState((state) => ({
      plan: { ...state.plan, panels: [floor({})], plot: rectPlotFromFt(20, 20) },
      past: [],
      future: [],
      message: null,
    }));
    useStore.getState().movePanel('f', 9, 0);
    expect(panels()[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('lets a floor move under an existing roof, which is what a building is', () => {
    seedIn([floor({}), floor({ id: 'r', category: 'roof', x: 6 })]);
    useStore.getState().movePanel('f', 6, 0);
    expect(panels()[0]).toMatchObject({ x: 6, y: 0 });
  });

  it('leaves a wall drag unguarded, so the tidy-it-up-after workflow still works', () => {
    const wall = (id: string, x: number): Panel => ({
      id,
      category: 'wall',
      size: '4x10',
      x,
      y: 0,
      orientation: 'h',
    });
    seedIn([wall('a', 0), wall('b', 4)]);
    useStore.getState().movePanel('a', 4, 0);
    expect(panels()[0]).toMatchObject({ x: 4, y: 0 });
  });
});

describe('hidden layers', () => {
  function seedIn(panelsIn: Panel[], hiddenLayers: PanelCategory[] = [], selection: string[] = []) {
    useStore.setState((state) => ({
      plan: { ...state.plan, panels: panelsIn, plot: rectPlotFromFt(80, 80) },
      past: [],
      future: [],
      selection,
      hiddenLayers,
      areaAxis: {},
      message: null,
    }));
  }

  const wall = (id: string, x: number): Panel => ({
    id,
    category: 'wall',
    size: '4x10',
    x,
    y: 0,
    orientation: 'h',
  });
  const floor = (id: string, x = 0): Panel => ({
    id,
    category: 'floor',
    size: '4x10',
    x,
    y: 0,
    orientation: 'h',
  });

  const hidden = () => useStore.getState().hiddenLayers;

  describe('nothing is ever created invisible', () => {
    it('reveals a category when panels are added to it', () => {
      seedIn([], ['wall']);
      useStore.getState().addPanels([wall('a', 0)]);
      expect(hidden()).not.toContain('wall');
    });

    it('reveals the target category of a conversion', () => {
      // Doors hidden, then a wall is turned into one: without this the panel
      // silently vanishes and the tool looks broken.
      seedIn([wall('a', 0)], ['door']);
      useStore.getState().setPanelCategory('a', 'door');
      expect(hidden()).not.toContain('door');
    });

    it('reveals a floor that gets filled after being hidden and cleared', () => {
      const room = [
        ...tileRun(0, 0, 10, 'h')!,
        ...tileRun(0, 10, 10, 'h')!,
        ...tileRun(0, 0, 10, 'v')!,
        ...tileRun(10, 0, 10, 'v')!,
      ];
      seedIn(room, ['floor']);
      useStore.getState().fillArea('floor');
      expect(hidden()).not.toContain('floor');
      expect(panels().some((p) => p.category === 'floor')).toBe(true);
    });

    it('leaves other hidden categories alone', () => {
      seedIn([], ['wall', 'roof']);
      useStore.getState().addPanels([wall('a', 0)]);
      expect(hidden()).toEqual(['roof']);
    });

    it('does not reveal a category that only shrank', () => {
      // Clearing a hidden floor must not un-hide it: nothing appeared.
      seedIn([floor('f')], ['floor']);
      useStore.getState().clearArea('floor');
      expect(hidden()).toContain('floor');
    });

    it('does not reveal on a move, which creates nothing', () => {
      seedIn([wall('a', 0)], ['roof']);
      useStore.getState().movePanel('a', 4, 0);
      expect(hidden()).toContain('roof');
    });
  });

  describe('hidden panels are not selected', () => {
    it('drops the hidden category from the selection', () => {
      seedIn([wall('a', 0), floor('f', 0)], [], ['a', 'f']);
      useStore.getState().toggleLayer('floor');
      expect(useStore.getState().selection).toEqual(['a']);
    });

    it('leaves the selection alone when showing a layer again', () => {
      seedIn([wall('a', 0)], ['floor'], ['a']);
      useStore.getState().toggleLayer('floor');
      expect(useStore.getState().selection).toEqual(['a']);
      expect(hidden()).toEqual([]);
    });

    it('keeps selectAll to what is on screen', () => {
      seedIn([wall('a', 0), floor('f', 0)], ['floor']);
      useStore.getState().selectAll();
      expect(useStore.getState().selection).toEqual(['a']);
    });
  });

  describe('showAllLayers', () => {
    it('reveals everything at once', () => {
      seedIn([wall('a', 0)], ['wall', 'floor', 'roof']);
      useStore.getState().showAllLayers();
      expect(hidden()).toEqual([]);
    });
  });
});
