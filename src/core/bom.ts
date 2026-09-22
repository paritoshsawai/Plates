/**
 * The bill of materials.
 *
 * This object is the product: it is simultaneously the customer's quote and the
 * factory's build list. Everything here is plain serialisable data so it can be
 * exported, POSTed to an ERP, or turned into a work order without rework.
 *
 * Lines are grouped by category, each group carrying its own subtotal before
 * the grand total, because a wall panel and a roof panel of identical
 * dimensions are different SKUs at different prices.
 */

import {
  CATEGORY_STYLE,
  CONNECTOR_STYLE,
  PANEL_CATALOG,
  getPanelSpec,
  isKnownPanelSize,
  skuKey,
} from './panels';
import { countJunctions } from './junctions';
import { priceDateOf, priceOf } from './pricing';
import { minPanelCount } from './tiling';
import { GRID_FT, unitsToFt } from './units';
import { isLinearCategory } from './types';
import { buildEdgeIndex, collinearRuns, coveredEdgeCount } from './walls';
import type {
  Bom,
  BomGroup,
  BomLine,
  ConnectorType,
  Panel,
  PanelCategory,
  PriceConfig,
  UtilizationReport,
} from './types';

/** Panel counts keyed `${category}:${size}`. */
export function countPanels(panels: Panel[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const panel of panels) {
    const key = skuKey(panel.category, panel.size);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Material utilisation.
 *
 * Offcut is always zero: panels are laid whole, never cut. The figure worth
 * reporting is what a cut-to-fit build would have thrown away for the same
 * walls - every 2 ft remainder sawn from a 4 ft board leaves a 2 ft offcut -
 * and how close the layout is to the fewest panels that cover this geometry.
 *
 * Every figure here is about the wall line. Area categories (floor, roof) are
 * excluded rather than silently folded in, because their tiling constraint is
 * different and mixing them would make the optimality figure meaningless.
 */
export function utilization(panels: Panel[]): UtilizationReport {
  const linear = panels.filter((panel) => isLinearCategory(panel.category));
  const index = buildEdgeIndex(linear);
  const linearFt = unitsToFt(coveredEdgeCount(index));

  let optimalPanelCount = 0;
  let remainderRuns = 0;
  for (const run of collinearRuns(index)) {
    optimalPanelCount += minPanelCount(run.lengthUnits) ?? 0;
    if (run.lengthUnits % 2 === 1) remainderRuns += 1;
  }

  const panelCount = linear.length;
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

/** Categories in the order they should read on a quote. */
const CATEGORY_ORDER: PanelCategory[] = ['wall', 'door', 'window', 'floor', 'roof'];

export function buildBom(panels: Panel[], config: PriceConfig): Bom {
  const counts = countPanels(panels);
  const connectorCounts = countJunctions(panels);

  const groups: BomGroup[] = [];
  const dates: string[] = [];

  for (const category of CATEGORY_ORDER) {
    const lines: BomLine[] = PANEL_CATALOG.map((spec) => {
      const qty = counts[skuKey(category, spec.id)] ?? 0;
      const unitPrice = priceOf(config, category, spec.id);
      if (qty > 0) dates.push(priceDateOf(config, category, spec.id));
      return {
        category,
        sku: spec.id,
        description: `${CATEGORY_STYLE[category].label} ${spec.label}`,
        qty,
        unitPrice,
        lineTotal: qty * unitPrice,
      };
    });

    // A category nobody has used yet would be noise on the quote; wall always
    // shows so an empty plan still renders a recognisable BOM.
    const qty = lines.reduce((sum, line) => sum + line.qty, 0);
    if (qty === 0 && category !== 'wall') continue;

    groups.push({
      category,
      label: CATEGORY_STYLE[category].plural,
      lines,
      qty,
      subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    });
  }

  const connectorLines: BomLine[] = (Object.keys(CONNECTOR_STYLE) as ConnectorType[]).map(
    (type) => {
      const qty = connectorCounts[type];
      const unitPrice = priceOf(config, 'connector', type);
      if (qty > 0) dates.push(priceDateOf(config, 'connector', type));
      return {
        category: 'connector' as const,
        sku: type,
        description: CONNECTOR_STYLE[type].label,
        qty,
        unitPrice,
        lineTotal: qty * unitPrice,
      };
    },
  );
  const totalConnectors = connectorLines.reduce((sum, line) => sum + line.qty, 0);
  if (totalConnectors > 0) {
    groups.push({
      category: 'connector',
      label: 'Connectors',
      lines: connectorLines,
      qty: totalConnectors,
      subtotal: connectorLines.reduce((sum, line) => sum + line.lineTotal, 0),
    });
  }

  const lines = groups.flatMap((group) => group.lines);
  const totalPanels = groups
    .filter((group) => group.category !== 'connector')
    .reduce((sum, group) => sum + group.qty, 0);

  const panelsCost = groups
    .filter((group) => group.category !== 'connector')
    .reduce((sum, group) => sum + group.subtotal, 0);
  const connectorsCost = totalConnectors > 0 ? connectorLines.reduce((s, l) => s + l.lineTotal, 0) : 0;

  const billable = totalPanels + totalConnectors;
  const labor = totalPanels * config.laborPerPanel;
  const transport =
    totalPanels * config.transportPerPanel + (billable > 0 ? config.transportFlat : 0);
  const taxable = panelsCost + connectorsCost + labor + transport;
  const tax = (taxable * config.taxPercent) / 100;

  return {
    groups,
    lines,
    counts,
    connectorCounts,
    totalPanels,
    totalConnectors,
    cost: {
      panels: panelsCost,
      connectors: connectorsCost,
      labor,
      transport,
      tax,
      total: taxable + tax,
    },
    utilization: utilization(panels),
    currency: config.currency,
    // Cite the newest row that actually priced something, so the quote's date
    // reflects the schedule it was really built from.
    priceEffectiveDate: dates.length > 0 ? dates.sort().at(-1)! : config.effectiveDate,
  };
}

/**
 * Linear feet a BOM line contributes, or null when the line is not a panel.
 * Connector SKUs carry a junction type rather than a size, so exports ask this
 * instead of assuming every line has a footprint.
 */
export function lineLinearFt(line: BomLine): number | null {
  if (line.category === 'connector' || !isKnownPanelSize(line.sku)) return null;
  return getPanelSpec(line.sku).widthFt * line.qty;
}
