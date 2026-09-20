import { describe, expect, it } from 'vitest';
import { buildBom, countPanels, utilization } from '../bom';
import { DEFAULT_PRICE_CONFIG, normalizePriceConfig } from '../pricing';
import { tileRun } from '../tiling';
import { ftToUnits } from '../units';
import type { Panel, PanelCategory, PriceConfig } from '../types';

function closedRoom(widthFt: number, heightFt: number, category: PanelCategory = 'wall'): Panel[] {
  const w = ftToUnits(widthFt);
  const h = ftToUnits(heightFt);
  return [
    ...tileRun(0, 0, w, 'h', category)!,
    ...tileRun(0, h, w, 'h', category)!,
    ...tileRun(0, 0, h, 'v', category)!,
    ...tileRun(w, 0, h, 'v', category)!,
  ];
}

/** A schedule with distinct prices per category, so a mix-up cannot pass. */
function schedule(overrides: Partial<PriceConfig> = {}): PriceConfig {
  return normalizePriceConfig({
    effectiveDate: '2026-04-01',
    rows: [
      { category: 'wall', size: '4x10', unitPrice: 3500 },
      { category: 'wall', size: '2x10', unitPrice: 2100 },
      { category: 'connector', size: 'corner', unitPrice: 800 },
      { category: 'connector', size: 't-junction', unitPrice: 950 },
      { category: 'connector', size: 'cross', unitPrice: 1100 },
    ],
    ...overrides,
  });
}

describe('countPanels', () => {
  it('keys counts by category and size together', () => {
    // 20 ft -> five 4 ft panels; 16 ft -> four. Two runs of each.
    expect(countPanels(closedRoom(20, 16))).toEqual({ 'wall:4x10': 18 });
  });

  it('counts one 2 ft panel per run with a 2 ft remainder', () => {
    // 18 ft -> 4x4 + 1x2; 14 ft -> 3x4 + 1x2. Four runs, all with a remainder.
    expect(countPanels(closedRoom(18, 14))).toEqual({ 'wall:4x10': 14, 'wall:2x10': 4 });
  });

  it('keeps the same footprint in different categories apart', () => {
    const panels = [...closedRoom(20, 16, 'wall'), ...closedRoom(20, 16, 'roof')];
    expect(countPanels(panels)).toEqual({ 'wall:4x10': 18, 'roof:4x10': 18 });
  });
});

describe('buildBom', () => {
  it('prices panels from the config, not from hard-coded numbers', () => {
    const bom = buildBom(closedRoom(18, 14), schedule());

    expect(bom.counts).toEqual({ 'wall:4x10': 14, 'wall:2x10': 4 });
    expect(bom.totalPanels).toBe(18);
    expect(bom.cost.panels).toBe(14 * 3500 + 4 * 2100);
    expect(bom.priceEffectiveDate).toBe('2026-04-01');
  });

  it('groups lines by category with a subtotal each', () => {
    const bom = buildBom(closedRoom(20, 16), schedule());
    const wall = bom.groups.find((g) => g.category === 'wall')!;

    expect(wall.label).toBe('Wall panels');
    expect(wall.qty).toBe(18);
    expect(wall.subtotal).toBe(18 * 3500);
    expect(bom.groups.map((g) => g.category)).toEqual(['wall', 'connector']);
  });

  it('prices the same footprint differently per category', () => {
    const config = normalizePriceConfig({
      rows: [
        { category: 'wall', size: '4x10', unitPrice: 3500 },
        { category: 'roof', size: '4x10', unitPrice: 5200 },
      ],
    });
    const bom = buildBom([...closedRoom(20, 16, 'wall'), ...closedRoom(20, 16, 'roof')], config);

    expect(bom.groups.find((g) => g.category === 'wall')!.subtotal).toBe(18 * 3500);
    expect(bom.groups.find((g) => g.category === 'roof')!.subtotal).toBe(18 * 5200);
  });

  it('bills the four corners of a closed room as their own line', () => {
    const bom = buildBom(closedRoom(20, 16), schedule());

    expect(bom.connectorCounts).toEqual({ corner: 4, 't-junction': 0, cross: 0 });
    expect(bom.totalConnectors).toBe(4);
    expect(bom.cost.connectors).toBe(4 * 800);
    // Wall panels count wall material only - a corner is never folded into them.
    expect(bom.cost.panels).toBe(18 * 3500);
  });

  it('hides categories nobody has used, but always shows walls', () => {
    const bom = buildBom([], schedule());
    expect(bom.groups.map((g) => g.category)).toEqual(['wall']);
    expect(bom.groups[0].lines.every((l) => l.qty === 0)).toBe(true);
  });

  it('adds labor, transport and tax when the admin configures them', () => {
    const config = schedule({
      laborPerPanel: 10,
      transportPerPanel: 5,
      transportFlat: 1000,
      taxPercent: 18,
    });
    const bom = buildBom(closedRoom(20, 16), config); // 18 wall panels, 4 corners

    const panels = 18 * 3500;
    const connectors = 4 * 800;
    expect(bom.cost.panels).toBe(panels);
    expect(bom.cost.connectors).toBe(connectors);
    expect(bom.cost.labor).toBe(180);
    expect(bom.cost.transport).toBe(18 * 5 + 1000);

    const taxable = panels + connectors + 180 + 1090;
    expect(bom.cost.tax).toBeCloseTo(taxable * 0.18, 6);
    expect(bom.cost.total).toBeCloseTo(taxable * 1.18, 6);
  });

  it('charges no flat transport on an empty plan', () => {
    expect(buildBom([], schedule({ transportFlat: 5000 })).cost.total).toBe(0);
  });

  it('cites the newest row date that actually priced something', () => {
    const config = normalizePriceConfig({
      effectiveDate: '2026-01-01',
      rows: [
        { category: 'wall', size: '4x10', unitPrice: 3500, effectiveDate: '2026-06-01' },
        { category: 'roof', size: '4x10', unitPrice: 5200, effectiveDate: '2026-09-01' },
      ],
    });
    // Only walls are placed, so the unused roof re-pricing must not be cited.
    expect(buildBom(closedRoom(20, 16), config).priceEffectiveDate).toBe('2026-06-01');
  });
});

describe('utilization', () => {
  it('reports zero offcut, because panels are never cut', () => {
    expect(utilization(closedRoom(18, 14)).offcutFt).toBe(0);
  });

  it('measures linear feet as each 2 ft of wall counted once', () => {
    // Perimeter of a 20 x 16 room = 72 ft.
    expect(utilization(closedRoom(20, 16)).linearFt).toBe(72);
  });

  it('reports 100% optimality for an auto-tiled layout', () => {
    const report = utilization(closedRoom(18, 14));
    expect(report.panelCount).toBe(report.optimalPanelCount);
    expect(report.optimalityPercent).toBe(100);
  });

  it('drops below 100% when a wall is built from too many small panels', () => {
    // A 4 ft run laid as two 2 ft panels where one 4 ft panel would do.
    const wasteful: Panel[] = [
      { id: 'a', category: 'wall', size: '2x10', x: 0, y: 0, orientation: 'h' },
      { id: 'b', category: 'wall', size: '2x10', x: 1, y: 0, orientation: 'h' },
    ];
    const report = utilization(wasteful);
    expect(report.panelCount).toBe(2);
    expect(report.optimalPanelCount).toBe(1);
    expect(report.optimalityPercent).toBe(50);
  });

  it('credits 2 ft of avoided offcut per wall run with a remainder', () => {
    expect(utilization(closedRoom(18, 14)).offcutAvoidedFt).toBe(8);
    expect(utilization(closedRoom(20, 16)).offcutAvoidedFt).toBe(0);
  });

  it('excludes area categories, whose tiling constraint is different', () => {
    // Roof panels must not inflate a figure that is about the wall line.
    const mixed = [...closedRoom(20, 16, 'wall'), ...closedRoom(20, 16, 'roof')];
    expect(utilization(mixed).linearFt).toBe(72);
    expect(utilization(mixed).panelCount).toBe(18);
  });

  it('returns a zeroed report for an empty plan', () => {
    expect(utilization([])).toMatchObject({ linearFt: 0, panelCount: 0, optimalityPercent: 0 });
  });
});

describe('the seeded schedule still costs a plan out', () => {
  it('uses the placeholder wall prices', () => {
    expect(buildBom(closedRoom(20, 16), DEFAULT_PRICE_CONFIG).cost.panels).toBe(18 * 20);
  });
});
