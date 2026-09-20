import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { buildEdgeIndex } from '../../core/walls';
import { edgeKey, panelEdges } from '../../core/panels';
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
