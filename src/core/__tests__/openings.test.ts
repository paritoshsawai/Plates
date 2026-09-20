import { describe, expect, it } from 'vitest';
import { buildBom } from '../bom';
import { countJunctions } from '../junctions';
import { PLAN_SCHEMA_VERSION, createPlan, deserializePlan, serializePlan } from '../plan';
import { normalizePriceConfig } from '../pricing';
import { tileRun } from '../tiling';
import { ftToUnits } from '../units';
import { validatePlan } from '../validation';
import { rectPlotFromFt } from '../plot';
import { isOpeningCategory } from '../types';
import type { Panel } from '../types';

const plot = rectPlotFromFt(40, 40);

function closedRoom(widthFt: number, heightFt: number): Panel[] {
  const w = ftToUnits(widthFt);
  const h = ftToUnits(heightFt);
  return [
    ...tileRun(0, 0, w, 'h')!,
    ...tileRun(0, h, w, 'h')!,
    ...tileRun(0, 0, h, 'v')!,
    ...tileRun(w, 0, h, 'v')!,
  ];
}

/** Convert one panel in place, the way the opening brush does. */
function withDoor(panels: Panel[], index = 0): Panel[] {
  return panels.map((panel, i) => (i === index ? { ...panel, category: 'door' as const } : panel));
}

describe('isOpeningCategory', () => {
  it('covers doors and windows only', () => {
    expect(isOpeningCategory('door')).toBe(true);
    expect(isOpeningCategory('window')).toBe(true);
    expect(isOpeningCategory('wall')).toBe(false);
    expect(isOpeningCategory('roof')).toBe(false);
  });
});

describe('an opening in a wall run', () => {
  it('leaves the layout manufacturable, since it occupies the same edges', () => {
    const result = validatePlan(withDoor(closedRoom(20, 16)), plot);
    expect(result.errors).toEqual([]);
    expect(result.manufacturable).toBe(true);
  });

  it('does not change the junction count', () => {
    const room = closedRoom(20, 16);
    expect(countJunctions(withDoor(room))).toEqual(countJunctions(room));
  });

  it('moves one line out of the wall group and into the door group', () => {
    const config = normalizePriceConfig({
      rows: [
        { category: 'wall', size: '4x10', unitPrice: 3500 },
        { category: 'door', size: '4x10', unitPrice: 9000 },
      ],
    });
    const room = closedRoom(20, 16); // 18 wall panels
    const before = buildBom(room, config);
    const after = buildBom(withDoor(room), config);

    expect(before.groups.find((g) => g.category === 'door')).toBeUndefined();
    expect(after.groups.find((g) => g.category === 'wall')!.qty).toBe(17);
    expect(after.groups.find((g) => g.category === 'door')!.qty).toBe(1);
    // Total panel count is unchanged: an opening replaces, never adds.
    expect(after.totalPanels).toBe(before.totalPanels);
    expect(after.cost.panels).toBe(17 * 3500 + 9000);
  });

  it('still counts toward wall length, because the run is unbroken', () => {
    const room = closedRoom(20, 16);
    expect(buildBom(withDoor(room), normalizePriceConfig(null)).utilization.linearFt).toBe(
      buildBom(room, normalizePriceConfig(null)).utilization.linearFt,
    );
  });

  it('reports open ends when the opening is the only panel', () => {
    const lone: Panel[] = [{ id: 'd', category: 'door', size: '4x10', x: 2, y: 2, orientation: 'h' }];
    const result = validatePlan(lone, plot);
    expect(result.errors.filter((e) => e.code === 'open-end')).toHaveLength(2);
  });
});

describe('opening detail round-trips', () => {
  it('keeps swing and sill height through a save and load', () => {
    const plan = createPlan('With openings');
    plan.panels = [
      {
        id: 'd',
        category: 'door',
        size: '4x10',
        x: 0,
        y: 0,
        orientation: 'h',
        opening: { swing: 'right' },
      },
      {
        id: 'w',
        category: 'window',
        size: '2x10',
        x: 2,
        y: 0,
        orientation: 'h',
        opening: { sillHeightFt: 3 },
      },
    ];
    const restored = deserializePlan(serializePlan(plan));

    expect(restored.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
    expect(restored.panels[0].opening).toEqual({ swing: 'right' });
    expect(restored.panels[1].opening).toEqual({ sillHeightFt: 3 });
  });

  it('drops opening detail from a category that cannot carry it', () => {
    const raw = JSON.stringify({
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [
        { id: 'a', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h', opening: { swing: 'left' } },
      ],
    });
    expect(deserializePlan(raw).panels[0].opening).toBeUndefined();
  });

  it('ignores a swing value that is not a real hinge side', () => {
    const raw = JSON.stringify({
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [
        { id: 'a', category: 'door', size: '4x10', x: 0, y: 0, orientation: 'h', opening: { swing: 'sideways' } },
      ],
    });
    expect(deserializePlan(raw).panels[0].opening).toBeUndefined();
  });

  it('loads a schema 2 opening that carries no detail yet', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [{ id: 'a', category: 'door', size: '4x10', x: 0, y: 0, orientation: 'h' }],
    });
    const plan = deserializePlan(raw);
    expect(plan.panels[0].category).toBe('door');
    expect(plan.panels[0].opening).toBeUndefined();
  });
});
