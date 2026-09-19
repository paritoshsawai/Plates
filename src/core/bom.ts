/**
 * The bill of materials.
 *
 * This object is the product: it is simultaneously the customer's quote and the
 * factory's build list. Everything here is plain serialisable data so it can be
 * exported, POSTed to an ERP, or turned into a work order without rework.
 */

import { PANEL_CATALOG, getPanelSpec } from './panels';
import { minPanelCount } from './tiling';
import { GRID_FT, unitsToFt } from './units';
import { buildEdgeIndex, collinearRuns, coveredEdgeCount } from './walls';
import type { Bom, BomLine, Panel, PanelTypeId, PriceConfig, UtilizationReport } from './types';

export function countPanels(panels: Panel[]): Record<PanelTypeId, number> {
  const counts: Record<PanelTypeId, number> = { '4x10': 0, '2x10': 0 };
  for (const panel of panels) {
    if (panel.type in counts) counts[panel.type] += 1;
  }
  return counts;
}

/**
 * Material utilisation.
 *
 * Offcut is always zero: panels are laid whole, never cut. The figure worth
 * reporting is what a cut-to-fit build would have thrown away for the same
 * walls - every 2 ft remainder sawn from a 4 ft board leaves a 2 ft offcut - and
 * how close the layout is to the fewest panels that cover this geometry.
 */
export function utilization(panels: Panel[]): UtilizationReport {
  const index = buildEdgeIndex(panels);
  const linearFt = unitsToFt(coveredEdgeCount(index));

  let optimalPanelCount = 0;
  let remainderRuns = 0;
  for (const run of collinearRuns(index)) {
    optimalPanelCount += minPanelCount(run.lengthUnits) ?? 0;
    if (run.lengthUnits % 2 === 1) remainderRuns += 1;
  }

  const panelCount = panels.length;
  const optimalityPercent =
    panelCount === 0 ? 0 : Math.min(100, (optimalPanelCount / panelCount) * 100);

  return {
    linearFt,
    panelCount,
    optimalPanelCount,
    optimalityPercent,
    offcutFt: 0,
    offcutAvoidedFt: remainderRuns * GRID_FT,
  };
}

export function buildBom(panels: Panel[], config: PriceConfig): Bom {
  const counts = countPanels(panels);

  const lines: BomLine[] = PANEL_CATALOG.map((spec) => {
    const qty = counts[spec.id] ?? 0;
    const unitPrice = config.panelUnitPrice[spec.id] ?? 0;
    return {
      sku: spec.id,
      description: `Wall panel ${spec.label}`,
      qty,
      unitPrice,
      lineTotal: qty * unitPrice,
    };
  });

  const totalPanels = lines.reduce((sum, line) => sum + line.qty, 0);
  const panelsCost = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const labor = totalPanels * config.laborPerPanel;
  const transport = totalPanels * config.transportPerPanel + (totalPanels > 0 ? config.transportFlat : 0);
  const taxable = panelsCost + labor + transport;
  const tax = (taxable * config.taxPercent) / 100;

  return {
    lines,
    counts,
    totalPanels,
    cost: {
      panels: panelsCost,
      labor,
      transport,
      tax,
      total: taxable + tax,
    },
    utilization: utilization(panels),
    currency: config.currency,
    priceEffectiveDate: config.effectiveDate,
  };
}

/** Linear feet of wall a given panel type contributes. */
export function linearFtOf(type: PanelTypeId, qty: number): number {
  return getPanelSpec(type).widthFt * qty;
}
