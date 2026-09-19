/**
 * The BOM as a manufacturing order.
 *
 * The panel count is simultaneously the quote and the factory's build list, so
 * the BOM is shaped as an API-addressable object from day one. Nothing here
 * touches the DOM: the same function serves a REST handler, a webhook payload
 * and the CSV export.
 */

import { plotAreaSqFt } from './plot';
import { WALL_HEIGHT_FT } from './units';
import type { Bom, Plan } from './types';

export interface WorkOrder {
  orderSchemaVersion: 1;
  status: 'draft';
  plan: {
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  };
  site: {
    plotAreaSqFt: number;
    wallHeightFt: number;
    wallLinearFt: number;
  };
  /** What the factory builds. */
  materials: Array<{ sku: string; description: string; qty: number }>;
  /** What the customer pays. */
  pricing: {
    currency: string;
    effectiveDate: string;
    lines: Array<{ sku: string; qty: number; unitPrice: number; lineTotal: number }>;
    panels: number;
    labor: number;
    transport: number;
    tax: number;
    total: number;
  };
  sustainability: {
    offcutFt: number;
    offcutAvoidedFt: number;
    panelOptimalityPercent: number;
  };
  generatedAt: string;
}

export function toWorkOrder(plan: Plan, bom: Bom): WorkOrder {
  return {
    orderSchemaVersion: 1,
    status: 'draft',
    plan: {
      id: plan.id,
      name: plan.name,
      version: plan.version,
      updatedAt: plan.updatedAt,
    },
    site: {
      plotAreaSqFt: plotAreaSqFt(plan.plot),
      wallHeightFt: WALL_HEIGHT_FT,
      wallLinearFt: bom.utilization.linearFt,
    },
    materials: bom.lines
      .filter((line) => line.qty > 0)
      .map((line) => ({ sku: line.sku, description: line.description, qty: line.qty })),
    pricing: {
      currency: bom.currency,
      effectiveDate: bom.priceEffectiveDate,
      lines: bom.lines.map((line) => ({
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      panels: bom.cost.panels,
      labor: bom.cost.labor,
      transport: bom.cost.transport,
      tax: bom.cost.tax,
      total: bom.cost.total,
    },
    sustainability: {
      offcutFt: bom.utilization.offcutFt,
      offcutAvoidedFt: bom.utilization.offcutAvoidedFt,
      panelOptimalityPercent: bom.utilization.optimalityPercent,
    },
    generatedAt: new Date().toISOString(),
  };
}
