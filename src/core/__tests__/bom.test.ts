import { describe, expect, it } from 'vitest';
import { buildBom, countPanels, utilization } from '../bom';
import { DEFAULT_PRICE_CONFIG, normalizePriceConfig } from '../pricing';
import { tileRun } from '../tiling';
import { ftToUnits } from '../units';
import type { Panel } from '../types';

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

describe('countPanels', () => {
  it('counts a 20 x 16 ft room: 4 runs, all divisible by 4', () => {
    // 20 ft -> five 4 ft panels; 16 ft -> four. Two of each run.
    expect(countPanels(closedRoom(20, 16))).toEqual({ '4x10': 18, '2x10': 0 });
  });

  it('counts one 2 ft panel per run with a 2 ft remainder', () => {
    // 18 ft -> 4x4 + 1x2; 14 ft -> 3x4 + 1x2. Four runs, all with a remainder.
    expect(countPanels(closedRoom(18, 14))).toEqual({ '4x10': 14, '2x10': 4 });
  });
});

describe('buildBom', () => {
  it('prices panels from the config, not from hard-coded numbers', () => {
    const config = normalizePriceConfig({
      effectiveDate: '2026-04-01',
      panelUnitPrice: { '4x10': 3500, '2x10': 2100 },
    });
    const bom = buildBom(closedRoom(18, 14), config);

    expect(bom.counts).toEqual({ '4x10': 14, '2x10': 4 });
    expect(bom.totalPanels).toBe(18);
    expect(bom.cost.panels).toBe(14 * 3500 + 4 * 2100);
    expect(bom.cost.total).toBe(bom.cost.panels);
    expect(bom.priceEffectiveDate).toBe('2026-04-01');
  });

  it('adds labor, transport and tax when the admin configures them', () => {
    const config = normalizePriceConfig({
      panelUnitPrice: { '4x10': 100, '2x10': 50 },
      laborPerPanel: 10,
      transportPerPanel: 5,
      transportFlat: 1000,
      taxPercent: 18,
    });
    const bom = buildBom(closedRoom(20, 16), config); // 18 panels, all 4x10

    expect(bom.cost.panels).toBe(1800);
    expect(bom.cost.labor).toBe(180);
    expect(bom.cost.transport).toBe(18 * 5 + 1000);
    const taxable = 1800 + 180 + 1090;
    expect(bom.cost.tax).toBeCloseTo(taxable * 0.18, 6);
    expect(bom.cost.total).toBeCloseTo(taxable * 1.18, 6);
  });

  it('charges no flat transport on an empty plan', () => {
    const config = normalizePriceConfig({ transportFlat: 5000 });
    const bom = buildBom([], config);
    expect(bom.cost.total).toBe(0);
  });

  it('still emits a line per catalog item at zero quantity', () => {
    const bom = buildBom([], DEFAULT_PRICE_CONFIG);
    expect(bom.lines.map((l) => l.sku)).toEqual(['4x10', '2x10']);
    expect(bom.lines.every((l) => l.qty === 0)).toBe(true);
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
      { id: 'a', type: '2x10', x: 0, y: 0, orientation: 'h' },
      { id: 'b', type: '2x10', x: 1, y: 0, orientation: 'h' },
    ];
    const report = utilization(wasteful);
    expect(report.panelCount).toBe(2);
    expect(report.optimalPanelCount).toBe(1);
    expect(report.optimalityPercent).toBe(50);
  });

  it('credits 2 ft of avoided offcut per wall run with a remainder', () => {
    // All four runs of an 18 x 14 room carry a 2 ft remainder.
    expect(utilization(closedRoom(18, 14)).offcutAvoidedFt).toBe(8);
    // No run has a remainder here.
    expect(utilization(closedRoom(20, 16)).offcutAvoidedFt).toBe(0);
  });

  it('returns a zeroed report for an empty plan', () => {
    expect(utilization([])).toMatchObject({ linearFt: 0, panelCount: 0, optimalityPercent: 0 });
  });
});
