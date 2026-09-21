import { describe, expect, it } from 'vitest';
import { resolveOpeningClick } from '../panels';
import type { Panel, PanelCategory } from '../types';

/**
 * What a click does while an opening brush is armed. Both views route through
 * this, so it is the one place the rule is stated - and the only guard the 3D
 * scene has, since it is a single flat group with no layers to hit-test with.
 */

const panel = (category: PanelCategory): Panel => ({
  id: 'p',
  category,
  size: '4x10',
  x: 0,
  y: 0,
  orientation: 'h',
});

describe('resolveOpeningClick', () => {
  it('is not a conversion when no brush is armed', () => {
    expect(resolveOpeningClick(panel('wall'), null)).toBeNull();
  });

  it('turns a wall into the armed opening', () => {
    expect(resolveOpeningClick(panel('wall'), 'door')).toBe('door');
    expect(resolveOpeningClick(panel('wall'), 'window')).toBe('window');
  });

  it('turns an opening back into a wall when clicked with its own tool', () => {
    expect(resolveOpeningClick(panel('door'), 'door')).toBe('wall');
    expect(resolveOpeningClick(panel('window'), 'window')).toBe('wall');
  });

  it('swaps one opening for another', () => {
    expect(resolveOpeningClick(panel('door'), 'window')).toBe('window');
  });

  it('refuses to cut an opening into a floor or a roof', () => {
    // The guard the 3D view needs: an opening is a pre-cut wall panel, so a
    // door brush clicking a floor slab must not turn the floor into a door.
    expect(resolveOpeningClick(panel('floor'), 'door')).toBeNull();
    expect(resolveOpeningClick(panel('roof'), 'window')).toBeNull();
  });

  it('is not a conversion when nothing was hit', () => {
    expect(resolveOpeningClick(undefined, 'door')).toBeNull();
  });

  it('ignores a brush that is not an opening at all', () => {
    expect(resolveOpeningClick(panel('wall'), 'wall')).toBeNull();
    expect(resolveOpeningClick(panel('wall'), 'floor')).toBeNull();
  });
});
