import { describe, expect, it } from 'vitest';
import {
  PLAN_SCHEMA_VERSION,
  PlanParseError,
  createPlan,
  deserializePlan,
  serializePlan,
} from '../plan';
import { buildBom } from '../bom';
import { DEFAULT_PRICE_CONFIG } from '../pricing';
import { toWorkOrder } from '../workorder';
import { tileRun } from '../tiling';
import { ftToUnits } from '../units';

function samplePlan() {
  const plan = createPlan('Unit A');
  plan.panels = [
    ...tileRun(0, 0, ftToUnits(20), 'h')!,
    ...tileRun(0, ftToUnits(16), ftToUnits(20), 'h')!,
    ...tileRun(0, 0, ftToUnits(16), 'v')!,
    ...tileRun(ftToUnits(20), 0, ftToUnits(16), 'v')!,
  ];
  return plan;
}

describe('plan serialisation', () => {
  it('round-trips a plan without loss', () => {
    const plan = samplePlan();
    const restored = deserializePlan(serializePlan(plan));
    expect(restored.panels).toEqual(plan.panels);
    expect(restored.plot).toEqual(plan.plot);
    expect(restored.name).toBe('Unit A');
    expect(restored.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
  });

  it('migrates a schema 1 plan, where every panel was a wall', () => {
    // Schema 1 stored the size as `type` and had no category at all.
    const v1 = JSON.stringify({
      schemaVersion: 1,
      name: 'Old plan',
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [{ id: 'a', type: '4x10', x: 0, y: 0, orientation: 'h' }],
    });
    const plan = deserializePlan(v1);

    expect(plan.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
    expect(plan.panels[0]).toMatchObject({ category: 'wall', size: '4x10' });
  });

  it('rejects a category that is not a known one', () => {
    const raw = JSON.stringify({
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [{ id: 'a', category: 'ceiling', size: '4x10', x: 0, y: 0, orientation: 'h' }],
    });
    expect(() => deserializePlan(raw)).toThrow(/unsupported category/);
  });

  it('round-trips a non-wall category', () => {
    const plan = createPlan('Mixed');
    plan.panels = [
      { id: 'a', category: 'roof', size: '4x10', x: 0, y: 0, orientation: 'h' },
    ];
    expect(deserializePlan(serializePlan(plan)).panels[0].category).toBe('roof');
  });

  it('accepts the rotation form as well as the orientation form', () => {
    const raw = JSON.stringify({
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [
        { id: 'a', size: '4x10', x: 0, y: 0, rotation: 0 },
        { id: 'b', size: '2x10', x: 0, y: 0, rotation: 90 },
      ],
    });
    const plan = deserializePlan(raw);
    expect(plan.panels.map((p) => p.orientation)).toEqual(['h', 'v']);
  });

  it('rejects a panel size Arplace does not manufacture', () => {
    const raw = JSON.stringify({
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [{ id: 'a', category: 'wall', size: '6x10', x: 0, y: 0, orientation: 'h' }],
    });
    expect(() => deserializePlan(raw)).toThrow(PlanParseError);
  });

  it('rejects off-grid coordinates instead of silently accepting them', () => {
    const raw = JSON.stringify({
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [{ id: 'a', category: 'wall', size: '4x10', x: 0.5, y: 0, orientation: 'h' }],
    });
    expect(() => deserializePlan(raw)).toThrow(/integer grid unit/);
  });

  it('rejects duplicate panel ids, which would break selection and undo', () => {
    const raw = JSON.stringify({
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [
        { id: 'a', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h' },
        { id: 'a', category: 'wall', size: '4x10', x: 2, y: 0, orientation: 'h' },
      ],
    });
    expect(() => deserializePlan(raw)).toThrow(/Duplicate panel id/);
  });

  it('rejects a plan from a newer schema rather than guessing', () => {
    const raw = JSON.stringify({
      schemaVersion: PLAN_SCHEMA_VERSION + 1,
      plot: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
      panels: [],
    });
    expect(() => deserializePlan(raw)).toThrow(/newer version/);
  });

  it('rejects malformed JSON with a readable message', () => {
    expect(() => deserializePlan('{not json')).toThrow(/not valid JSON/);
  });

  it('rejects a plan with no usable boundary', () => {
    expect(() => deserializePlan(JSON.stringify({ panels: [] }))).toThrow(/plot boundary/);
  });
});

describe('toWorkOrder', () => {
  it('carries the panel counts, price schedule and site figures', () => {
    const plan = samplePlan();
    const bom = buildBom(plan.panels, DEFAULT_PRICE_CONFIG);
    const order = toWorkOrder(plan, bom);

    // The factory list now names the category of every line, and the corner
    // hardware the layout needs arrives alongside the panels.
    expect(order.materials).toEqual([
      { category: 'wall', sku: '4x10', description: 'Wall panel 4 ft x 10 ft', qty: 18 },
      { category: 'connector', sku: 'corner', description: 'Corner connector', qty: 4 },
    ]);
    expect(order.site.wallLinearFt).toBe(72);
    expect(order.site.wallHeightFt).toBe(10);
    expect(order.pricing.effectiveDate).toBe(DEFAULT_PRICE_CONFIG.effectiveDate);
    expect(order.pricing.panels).toBe(18 * 20);
    expect(order.pricing.connectors).toBe(bom.cost.connectors);
    expect(order.pricing.total).toBe(18 * 20 + bom.cost.connectors);
    expect(order.status).toBe('draft');
  });

  it('omits catalog items with zero quantity from the factory list', () => {
    const plan = samplePlan();
    const bom = buildBom(plan.panels, DEFAULT_PRICE_CONFIG);
    expect(toWorkOrder(plan, bom).materials.some((m) => m.sku === '2x10')).toBe(false);
  });

  it('is JSON-serialisable, so it can be POSTed to an ERP unchanged', () => {
    const plan = samplePlan();
    const order = toWorkOrder(plan, buildBom(plan.panels, DEFAULT_PRICE_CONFIG));
    expect(JSON.parse(JSON.stringify(order))).toEqual(order);
  });
});
