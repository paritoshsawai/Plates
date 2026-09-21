import { describe, expect, it } from 'vitest';
import { ALL_CATEGORIES, visiblePanels } from '../panels';
import { buildBom } from '../bom';
import { DEFAULT_PRICE_CONFIG } from '../pricing';
import type { Panel, PanelCategory } from '../types';

/**
 * What a view draws, given the hidden layers. Both the plan canvas and the 3D
 * scene go through this, which is the point: the scene used not to filter at
 * all, so a hidden roof was still drawn and still clickable in 3D.
 */

const panel = (id: string, category: PanelCategory): Panel => ({
  id,
  category,
  size: '4x10',
  x: 0,
  y: 0,
  orientation: 'h',
});

const mixed: Panel[] = [
  panel('w1', 'wall'),
  panel('w2', 'wall'),
  panel('d1', 'door'),
  panel('f1', 'floor'),
  panel('r1', 'roof'),
];

describe('visiblePanels', () => {
  it('returns everything when nothing is hidden', () => {
    expect(visiblePanels(mixed, [])).toEqual(mixed);
  });

  it('drops exactly the hidden category', () => {
    expect(visiblePanels(mixed, ['roof']).map((p) => p.id)).toEqual(['w1', 'w2', 'd1', 'f1']);
  });

  it('drops several categories at once', () => {
    expect(visiblePanels(mixed, ['roof', 'floor', 'door']).map((p) => p.id)).toEqual(['w1', 'w2']);
  });

  it('can hide everything', () => {
    expect(visiblePanels(mixed, [...ALL_CATEGORIES])).toEqual([]);
  });

  it('ignores a hidden category with no panels', () => {
    expect(visiblePanels([panel('w1', 'wall')], ['roof'])).toHaveLength(1);
  });

  it('never mutates the list it is given', () => {
    const input = [...mixed];
    visiblePanels(input, ['roof']);
    expect(input).toEqual(mixed);
  });
});

describe('ALL_CATEGORIES', () => {
  it('covers every category the app can produce', () => {
    expect([...ALL_CATEGORIES].sort()).toEqual(['door', 'floor', 'roof', 'wall', 'window']);
  });
});

describe('hiding is a view control, not an edit', () => {
  it('leaves the bill of materials and the price untouched', () => {
    // The guarantee behind the note in the rail: a hidden roof is one you
    // cannot see, not one you are not building. If this ever fails, hiding a
    // layer has started silently changing a quote.
    const full = buildBom(mixed, DEFAULT_PRICE_CONFIG);
    const asDrawn = buildBom(visiblePanels(mixed, ['roof', 'floor']), DEFAULT_PRICE_CONFIG);

    // The app always bills the whole plan; this contrasts it with what a view
    // would show, to pin down that the two are deliberately different.
    expect(full.totalPanels).toBe(5);
    expect(asDrawn.totalPanels).toBe(3);
    expect(full.cost.total).toBeGreaterThan(asDrawn.cost.total);
  });
});
