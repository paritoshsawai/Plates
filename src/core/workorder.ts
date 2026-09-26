/**
 * The BOM as a manufacturing order.
 *
 * The panel count is simultaneously the quote and the factory's build list, so
 * the BOM is shaped as an API-addressable object from day one. Nothing here
 * touches the DOM: the same function serves a REST handler, a webhook payload
 * and the CSV export.
 */

import { plotAreaSqFt } from './plot';
import { WALL_HEIGHT_FT, areaToDisplay, toDisplay } from './units';
import type { LengthUnit } from './units';
import type { Bom, Plan } from './types';

export interface WorkOrder {
  orderSchemaVersion: 2;
  status: 'draft';
  /**
   * The unit every length and area below is expressed in.
   *
   * Schema 1 spelt the unit into the field names - `wallHeightFt` - which made
   * them unusable the moment the tool could speak metres: a converted value
   * under a key asserting feet is worse than no value at all. Version 2 names
   * the measurements plainly and declares the unit once, here.
   *
   * Panel SKUs are untouched by it. `4x10` is a part number, not a dimension.
   */
  units: LengthUnit;
  plan: {
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  };
  site: {
    plotArea: number;
    wallHeight: number;
    wallLinear: number;
  };
  /** What the factory builds, category by category. */
  materials: Array<{ category: string; sku: string; description: string; qty: number }>;
  /** What the customer pays. */
  pricing: {
    currency: string;
    effectiveDate: string;
    lines: Array<{ category: string; sku: string; qty: number; unitPrice: number; lineTotal: number }>;
    panels: number;
    connectors: number;
    labor: number;
    transport: number;
    tax: number;
    total: number;
  };
  sustainability: {
    offcut: number;
    offcutAvoided: number;
    panelOptimalityPercent: number;
  };
  generatedAt: string;
}

export function toWorkOrder(plan: Plan, bom: Bom, units: LengthUnit = 'ft'): WorkOrder {
  const len = (ft: number) => Math.round(toDisplay(ft, units) * 1e4) / 1e4;
  return {
    orderSchemaVersion: 2,
    status: 'draft',
    units,
    plan: {
      id: plan.id,
      name: plan.name,
      version: plan.version,
      updatedAt: plan.updatedAt,
    },
    site: {
      plotArea: Math.round(areaToDisplay(plotAreaSqFt(plan.plot), units) * 1e4) / 1e4,
      wallHeight: len(WALL_HEIGHT_FT),
      wallLinear: len(bom.utilization.linearFt),
    },
    materials: bom.lines
      .filter((line) => line.qty > 0)
      .map((line) => ({
        category: line.category,
        sku: line.sku,
        description: line.description,
        qty: line.qty,
      })),
    pricing: {
      currency: bom.currency,
      effectiveDate: bom.priceEffectiveDate,
      lines: bom.lines.map((line) => ({
        category: line.category,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      panels: bom.cost.panels,
      connectors: bom.cost.connectors,
      labor: bom.cost.labor,
      transport: bom.cost.transport,
      tax: bom.cost.tax,
      total: bom.cost.total,
    },
    sustainability: {
      offcut: len(bom.utilization.offcutFt),
      offcutAvoided: len(bom.utilization.offcutAvoidedFt),
      panelOptimalityPercent: bom.utilization.optimalityPercent,
    },
    generatedAt: new Date().toISOString(),
  };
}
