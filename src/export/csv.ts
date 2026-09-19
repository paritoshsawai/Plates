/** CSV export of the bill of materials. */

import { getPanelSpec } from '../core/panels';
import { plotAreaSqFt } from '../core/plot';
import { WALL_HEIGHT_FT } from '../core/units';
import type { Bom, Plan } from '../core/types';

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(cells: Array<string | number>): string {
  return cells.map(escapeCell).join(',');
}

export function bomToCsv(plan: Plan, bom: Bom): string {
  const lines: string[] = [];

  lines.push(row(['Arplace Panel Studio - Bill of Materials']));
  lines.push(row(['Plan', plan.name]));
  lines.push(row(['Version', plan.version]));
  lines.push(row(['Generated', new Date().toISOString()]));
  lines.push(row(['Price schedule effective', bom.priceEffectiveDate]));
  lines.push(row(['Currency', bom.currency]));
  lines.push(row(['Plot area (sq ft)', plotAreaSqFt(plan.plot)]));
  lines.push(row(['Wall height (ft)', WALL_HEIGHT_FT]));
  lines.push(row(['Wall length (linear ft)', bom.utilization.linearFt]));
  lines.push('');

  lines.push(row(['SKU', 'Description', 'Qty', 'Linear ft', 'Unit price', 'Line total']));
  for (const line of bom.lines) {
    lines.push(
      row([
        line.sku,
        line.description,
        line.qty,
        getPanelSpec(line.sku).widthFt * line.qty,
        line.unitPrice,
        line.lineTotal,
      ]),
    );
  }
  lines.push(row(['', 'Total panels', bom.totalPanels, bom.utilization.linearFt, '', bom.cost.panels]));
  lines.push('');

  lines.push(row(['Cost component', 'Amount']));
  lines.push(row(['Panels', bom.cost.panels]));
  lines.push(row(['Labor', bom.cost.labor]));
  lines.push(row(['Transport', bom.cost.transport]));
  lines.push(row(['Tax', bom.cost.tax]));
  lines.push(row(['Total', bom.cost.total]));
  lines.push('');

  lines.push(row(['Material utilisation', 'Value']));
  lines.push(row(['Offcut produced (ft)', bom.utilization.offcutFt]));
  lines.push(row(['Offcut avoided vs cut-to-fit (ft)', bom.utilization.offcutAvoidedFt]));
  lines.push(row(['Panels placed', bom.utilization.panelCount]));
  lines.push(row(['Fewest panels for this geometry', bom.utilization.optimalPanelCount]));
  lines.push(row(['Panel optimality (%)', Math.round(bom.utilization.optimalityPercent)]));

  return lines.join('\n');
}
