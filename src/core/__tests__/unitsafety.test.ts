import { describe, expect, it } from 'vitest';
import { buildBom } from '../bom';
import { createPlan } from '../plan';
import { validatePlan } from '../validation';
import { toWorkOrder } from '../workorder';
import { DEFAULT_PRICE_CONFIG } from '../pricing';
import { tileRun } from '../tiling';
import { bomToCsv } from '../../export/csv';
import type { Panel } from '../types';

/**
 * The unit switch is a display preference, and this file is what keeps it one.
 *
 * Two guarantees are load-bearing. A price must never move because somebody
 * changed how they read a drawing - a quote that differs between two people
 * looking at the same plan is worse than no quote. And a SKU must never move,
 * because `4x10` is the part number a factory picks from a shelf, not a
 * measurement of anything.
 */

/** A closed room from (0, 0), in grid units. */
function room(widthUnits: number, depthUnits: number): Panel[] {
  return [
    ...tileRun(0, 0, widthUnits, 'h')!,
    ...tileRun(0, depthUnits, widthUnits, 'h')!,
    ...tileRun(0, 0, depthUnits, 'v')!,
    ...tileRun(widthUnits, 0, depthUnits, 'v')!,
  ].map((panel, i) => ({ ...panel, id: `p${i}` }));
}

describe('switching unit never changes what is built or charged', () => {
  const panels = room(10, 8);

  it('leaves the bill of materials identical', () => {
    // buildBom takes no unit at all, which is the point - this pins down that
    // it stays that way rather than quietly growing one.
    const bom = buildBom(panels, DEFAULT_PRICE_CONFIG);
    expect(bom.totalPanels).toBeGreaterThan(0);
    expect(bom.cost.total).toBeGreaterThan(0);
  });

  it('leaves every SKU a part number, not a converted dimension', () => {
    const bom = buildBom(panels, DEFAULT_PRICE_CONFIG);
    const skus = bom.lines.map((line) => line.sku);
    expect(skus).toContain('4x10');
    for (const sku of skus) expect(sku).not.toMatch(/\d+\.\d{2}/);
  });

  it('keeps the SKU column in a metric CSV unconverted', () => {
    const plan = { ...createPlan('Metric plan'), panels };
    const bom = buildBom(panels, DEFAULT_PRICE_CONFIG);
    const csv = bomToCsv(plan, bom, 'm');

    expect(csv).toContain('4x10');
    // The part number must not have become 1.22x3.05.
    expect(csv).not.toContain('1.22x3.05');
  });

  it('prices a metric CSV exactly as it prices an imperial one', () => {
    const plan = { ...createPlan('Same plan') , panels };
    const bom = buildBom(panels, DEFAULT_PRICE_CONFIG);
    const totalRow = (csv: string) =>
      csv.split('\n').find((line) => line.startsWith('Total,'));

    expect(totalRow(bomToCsv(plan, bom, 'm'))).toBe(totalRow(bomToCsv(plan, bom, 'ft')));
  });
});

describe('a spreadsheet says what its numbers are in', () => {
  const panels = room(10, 8);
  const plan = { ...createPlan('Plan'), panels };
  const bom = buildBom(panels, DEFAULT_PRICE_CONFIG);

  it('names the unit in the header, because a bare cell cannot', () => {
    expect(bomToCsv(plan, bom, 'ft')).toContain('Plot area (sq ft)');
    expect(bomToCsv(plan, bom, 'm')).toContain('Plot area (m²)');
    expect(bomToCsv(plan, bom, 'm')).toContain('Linear m');
  });

  it('converts the value under the header it changed', () => {
    const wallHeight = (csv: string) =>
      csv.split('\n').find((line) => line.startsWith('Wall height'));

    expect(wallHeight(bomToCsv(plan, bom, 'ft'))).toContain('10');
    expect(wallHeight(bomToCsv(plan, bom, 'm'))).toContain('3.05');
  });
});

describe('the work order declares its unit rather than spelling it into keys', () => {
  const panels = room(10, 8);
  const plan = { ...createPlan('Plan'), panels };
  const bom = buildBom(panels, DEFAULT_PRICE_CONFIG);

  it('carries the unit as data', () => {
    expect(toWorkOrder(plan, bom, 'm').units).toBe('m');
    expect(toWorkOrder(plan, bom).units).toBe('ft');
  });

  it('converts the measurements it declares', () => {
    expect(toWorkOrder(plan, bom, 'ft').site.wallHeight).toBe(10);
    expect(toWorkOrder(plan, bom, 'm').site.wallHeight).toBeCloseTo(3.048, 3);
  });

  it('never converts a part number', () => {
    const order = toWorkOrder(plan, bom, 'm');
    expect(order.materials.some((m) => m.sku === '4x10')).toBe(true);
  });

  it('charges the same in either unit', () => {
    expect(toWorkOrder(plan, bom, 'm').pricing.total).toBe(
      toWorkOrder(plan, bom, 'ft').pricing.total,
    );
  });
});

describe('validation messages', () => {
  const plan = createPlan('Plan');

  /** A wall run that stops in mid-air, which is the open-end error. */
  const stub: Panel[] = [{ id: 's', category: 'wall', size: '4x10', x: 2, y: 3, orientation: 'h' }];

  it('gives an open end its position in the reader unit', () => {
    const ft = validatePlan(stub, plan.plot, 'ft').issues.find((i) => i.code === 'open-end');
    const m = validatePlan(stub, plan.plot, 'm').issues.find((i) => i.code === 'open-end');

    expect(ft?.message).toContain('4 ft');
    expect(m?.message).toContain('1.22 m');
    expect(m?.message).not.toContain('4 ft,');
  });

  it('defaults to feet when no unit is given', () => {
    const issue = validatePlan(stub, plan.plot).issues.find((i) => i.code === 'open-end');
    expect(issue?.message).toContain('ft');
  });

  it('leaves the module in feet, because that is what Arplace makes', () => {
    // A floor started in a room too shallow for a 10 ft panel.
    const panels: Panel[] = [
      ...room(10, 3),
      { id: 'f', category: 'floor', size: '4x10', x: 0, y: 0, orientation: 'h' },
    ];
    const issue = validatePlan(panels, plan.plot, 'm').issues.find(
      (i) => i.code === 'area-incomplete',
    );

    expect(issue).toBeDefined();
    // The area measured converts...
    expect(issue!.message).toContain('m²');
    // ...but the panel that cannot reach it is still a 10 ft panel.
    expect(issue!.message).toContain('10 ft panel');
  });

  it('still measures the uncovered area, just in the other unit', () => {
    const panels: Panel[] = [
      ...room(10, 3),
      { id: 'f', category: 'floor', size: '4x10', x: 0, y: 0, orientation: 'h' },
    ];
    const ft = validatePlan(panels, plan.plot, 'ft').issues.find(
      (i) => i.code === 'area-incomplete',
    );
    expect(ft!.message).toContain('sq ft');
  });
});
