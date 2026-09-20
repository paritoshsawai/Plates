import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { buildEdgeIndex } from '../../core/walls';
import { edgeKey, panelEdges } from '../../core/panels';
import { rectPlotFromFt } from '../../core/plot';
import type { Panel } from '../../core/types';

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
