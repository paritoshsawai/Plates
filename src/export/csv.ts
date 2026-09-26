/** CSV export of the bill of materials. */

import { lineLinearFt } from '../core/bom';
import { plotAreaSqFt } from '../core/plot';
import { WALL_HEIGHT_FT, areaToDisplay, areaUnitLabel, toDisplay } from '../core/units';
import type { LengthUnit } from '../core/units';
import type { Bom, Plan } from '../core/types';

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(cells: Array<string | number>): string {
  return cells.map(escapeCell).join(',');
}

/** A figure for a spreadsheet cell, at a precision that survives the unit. */
function len(ft: number, unit: LengthUnit): number {
  return Math.round(toDisplay(ft, unit) * 100) / 100;
}

/**
 * `unit` names the unit in the *column headers* and converts the values. A
 * bare number in a spreadsheet has no unit attached, so the header is the only
 * place the reader can learn what they are looking at.
 *
 * The SKU column never converts: `4x10` is a part number.
 */
export function bomToCsv(plan: Plan, bom: Bom, unit: LengthUnit = 'ft'): string {
  const lines: string[] = [];
  const area = areaUnitLabel(unit);

  lines.push(row(['Arplace Panel Studio - Bill of Materials']));
  lines.push(row(['Plan', plan.name]));
  lines.push(row(['Version', plan.version]));
  lines.push(row(['Generated', new Date().toISOString()]));
  lines.push(row(['Price schedule effective', bom.priceEffectiveDate]));
  lines.push(row(['Currency', bom.currency]));
  lines.push(
    row([
      `Plot area (${area})`,
      Math.round(areaToDisplay(plotAreaSqFt(plan.plot), unit) * 100) / 100,
    ]),
  );
  lines.push(row([`Wall height (${unit})`, len(WALL_HEIGHT_FT, unit)]));
  lines.push(row([`Wall length (linear ${unit})`, len(bom.utilization.linearFt, unit)]));
  lines.push('');

  lines.push(
    row([
      'Category',
      'SKU',
      'Description',
      'Qty',
      `Linear ${unit}`,
      'Unit price',
      'Line total',
    ]),
  );
  for (const group of bom.groups) {
    for (const line of group.lines) {
      lines.push(
        row([
          line.category,
          line.sku,
          line.description,
          line.qty,
          lineLinearFt(line) === null ? '' : len(lineLinearFt(line)!, unit),
          line.unitPrice,
          line.lineTotal,
        ]),
      );
    }
    lines.push(row(['', '', `${group.label} subtotal`, group.qty, '', '', group.subtotal]));
  }
  lines.push(
    row([
      '',
      '',
      'Total panels',
      bom.totalPanels,
      len(bom.utilization.linearFt, unit),
      '',
      bom.cost.panels,
    ]),
  );
  lines.push(row(['', '', 'Total connectors', bom.totalConnectors, '', '', bom.cost.connectors]));
  lines.push('');

  lines.push(row(['Cost component', 'Amount']));
  lines.push(row(['Panels', bom.cost.panels]));
  lines.push(row(['Connectors', bom.cost.connectors]));
  lines.push(row(['Labor', bom.cost.labor]));
  lines.push(row(['Transport', bom.cost.transport]));
  lines.push(row(['Tax', bom.cost.tax]));
  lines.push(row(['Total', bom.cost.total]));
  lines.push('');

  lines.push(row(['Material utilisation', 'Value']));
  lines.push(row([`Offcut produced (${unit})`, len(bom.utilization.offcutFt, unit)]));
  lines.push(
    row([`Offcut avoided vs cut-to-fit (${unit})`, len(bom.utilization.offcutAvoidedFt, unit)]),
  );
  lines.push(row(['Panels placed', bom.utilization.panelCount]));
  lines.push(row(['Fewest panels for this geometry', bom.utilization.optimalPanelCount]));
  lines.push(row(['Panel optimality (%)', Math.round(bom.utilization.optimalityPercent)]));

  return lines.join('\n');
}
