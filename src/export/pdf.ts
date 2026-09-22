/**
 * PDF quote: the plan drawing on page 1, the bill of materials and costs
 * underneath it. This is the document that leaves the building, so it carries
 * the price schedule's effective date and a warning when prices are still the
 * seeded placeholders.
 */

import { jsPDF } from 'jspdf';
import { lineLinearFt } from '../core/bom';
import { plotAreaSqFt } from '../core/plot';
import { formatCurrencyAscii, isPlaceholderPricing, toPdfSafeText } from '../core/pricing';
import { WALL_HEIGHT_FT, formatFt } from '../core/units';
import type { Bom, Plan, PriceConfig, ValidationResult } from '../core/types';

const MARGIN = 14;

/**
 * Every string reaching the page goes through here. Plan names and the price
 * note are free text, and one smart quote pasted from a document is enough to
 * corrupt a whole line under jsPDF's built-in WinAnsi fonts.
 */
function write(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  options?: Parameters<jsPDF['text']>[3],
): void {
  doc.text(toPdfSafeText(text), x, y, options);
}

export interface QuoteInput {
  plan: Plan;
  bom: Bom;
  priceConfig: PriceConfig;
  validation: ValidationResult;
  /** PNG data URL of the canvas, or null when the drawing is unavailable. */
  planImage: string | null;
}

export function buildQuotePdf({ plan, bom, priceConfig, validation, planImage }: QuoteInput): jsPDF {
  // compress keeps the embedded plan bitmap from dominating the file size.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  write(doc, 'Arplace Panel Studio', MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  write(doc, 'Panel layout, bill of materials and estimate', MARGIN, y);
  doc.setTextColor(0);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  write(doc, plan.name, MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  write(doc, `Version ${plan.version}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 5;
  doc.setTextColor(110);
  write(doc, `Generated ${new Date().toLocaleString('en-IN')}`, MARGIN, y);
  doc.setTextColor(0);
  y += 7;

  if (!validation.manufacturable) {
    y = drawBanner(
      doc,
      y,
      pageWidth,
      'NOT YET MANUFACTURABLE - this layout still has validation errors.',
      [220, 38, 38],
    );
  }
  if (isPlaceholderPricing(priceConfig)) {
    y = drawBanner(
      doc,
      y,
      pageWidth,
      'Indicative only - the price schedule is still the seeded placeholder.',
      [217, 119, 6],
    );
  }

  if (planImage) {
    // Fit inside the box, preserving the aspect ratio. Clamping the height
    // while leaving the width at full bleed - which is what this did - squashes
    // a tall plan horizontally, so a narrow deep building came out looking like
    // a different building.
    const boxWidth = pageWidth - MARGIN * 2;
    const boxHeight = 105;
    const props = doc.getImageProperties(planImage);
    const aspect = props.width / props.height;

    let imageWidth = boxWidth;
    let imageHeight = imageWidth / aspect;
    if (imageHeight > boxHeight) {
      imageHeight = boxHeight;
      imageWidth = imageHeight * aspect;
    }
    // Centre what is narrower than the page, so the drawing does not sit off
    // to one side of its own frame.
    const imageX = MARGIN + (boxWidth - imageWidth) / 2;

    doc.addImage(planImage, 'PNG', imageX, y, imageWidth, imageHeight, undefined, 'FAST');
    doc.setDrawColor(200);
    doc.rect(imageX, y, imageWidth, imageHeight);
    y += imageHeight + 8;
  }

  y = section(doc, y, 'Site');
  y = keyValues(doc, y, pageWidth, [
    ['Plot area', `${plotAreaSqFt(plan.plot).toLocaleString('en-IN')} sq ft`],
    ['Wall height', formatFt(WALL_HEIGHT_FT)],
    ['Wall length', formatFt(bom.utilization.linearFt)],
  ]);
  y += 4;

  y = section(doc, y, 'Bill of materials');
  y = table(
    doc,
    y,
    pageWidth,
    ['SKU', 'Description', 'Qty', 'Linear ft', 'Unit price', 'Line total'],
    bom.groups.flatMap((group) => [
      ...group.lines.map((line) => [
        line.sku,
        line.description,
        String(line.qty),
        lineLinearFt(line) === null ? '' : String(lineLinearFt(line)),
        formatCurrencyAscii(line.unitPrice),
        formatCurrencyAscii(line.lineTotal),
      ]),
      // Each category carries its own subtotal, so a quote reads as wall,
      // floor and roof rather than one undifferentiated list.
      ['', `${group.label} subtotal`, String(group.qty), '', '', formatCurrencyAscii(group.subtotal)],
    ]),
    ['', 'Total', String(bom.totalPanels + bom.totalConnectors), formatFt(bom.utilization.linearFt), '', formatCurrencyAscii(bom.cost.panels + bom.cost.connectors)],
  );
  y += 6;

  y = section(doc, y, 'Estimate');
  const costRows: Array<[string, string]> = [['Panels', formatCurrencyAscii(bom.cost.panels)]];
  if (bom.cost.connectors) costRows.push(['Connectors', formatCurrencyAscii(bom.cost.connectors)]);
  if (bom.cost.labor) costRows.push(['Labor', formatCurrencyAscii(bom.cost.labor)]);
  if (bom.cost.transport) costRows.push(['Transport', formatCurrencyAscii(bom.cost.transport)]);
  if (bom.cost.tax) costRows.push([`Tax (${priceConfig.taxPercent}%)`, formatCurrencyAscii(bom.cost.tax)]);
  costRows.push(['Total', formatCurrencyAscii(bom.cost.total)]);
  y = keyValues(doc, y, pageWidth, costRows, costRows.length - 1);
  y += 2;
  doc.setFontSize(8);
  doc.setTextColor(120);
  write(doc, `Price schedule effective ${bom.priceEffectiveDate}. ${priceConfig.note}`, MARGIN, y, {
    maxWidth: pageWidth - MARGIN * 2,
  });
  doc.setTextColor(0);
  y += 8;

  y = section(doc, y, 'Material utilisation');
  y = keyValues(doc, y, pageWidth, [
    ['Offcut produced', `${bom.utilization.offcutFt} ft - panels are laid whole, never cut`],
    ['Offcut avoided vs cut-to-fit', formatFt(bom.utilization.offcutAvoidedFt)],
    [
      'Panel optimality',
      `${Math.round(bom.utilization.optimalityPercent)}% (${bom.utilization.panelCount} placed, ${bom.utilization.optimalPanelCount} is the minimum)`,
    ],
  ]);

  return doc;
}

function drawBanner(
  doc: jsPDF,
  y: number,
  pageWidth: number,
  text: string,
  rgb: [number, number, number],
): number {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, 7, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  write(doc, text, MARGIN + 3, y + 4.8);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'normal');
  return y + 10;
}

function section(doc: jsPDF, y: number, title: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  write(doc, title, MARGIN, y);
  doc.setFont('helvetica', 'normal');
  return y + 5;
}

function keyValues(
  doc: jsPDF,
  startY: number,
  pageWidth: number,
  rows: Array<[string, string]>,
  boldIndex = -1,
): number {
  doc.setFontSize(9.5);
  let y = startY;
  rows.forEach(([label, value], i) => {
    doc.setFont('helvetica', i === boldIndex ? 'bold' : 'normal');
    write(doc, label, MARGIN, y);
    write(doc, value, pageWidth - MARGIN, y, { align: 'right' });
    y += 5;
  });
  doc.setFont('helvetica', 'normal');
  return y;
}

function table(
  doc: jsPDF,
  startY: number,
  pageWidth: number,
  headers: string[],
  rows: string[][],
  footer?: string[],
): number {
  const usable = pageWidth - MARGIN * 2;
  const weights = [0.12, 0.34, 0.09, 0.13, 0.16, 0.16];
  const xs: number[] = [];
  let cursor = MARGIN;
  for (const weight of weights) {
    xs.push(cursor);
    cursor += usable * weight;
  }
  const rightAligned = new Set([2, 3, 4, 5]);
  const cellX = (i: number) => (rightAligned.has(i) ? xs[i] + usable * weights[i] - 2 : xs[i]);
  const align = (i: number) => (rightAligned.has(i) ? 'right' : 'left');

  let y = startY;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(241, 245, 249);
  doc.rect(MARGIN, y - 4, usable, 6, 'F');
  headers.forEach((header, i) => write(doc, header, cellX(i), y, { align: align(i) }));
  y += 6;

  doc.setFont('helvetica', 'normal');
  for (const row of rows) {
    row.forEach((cell, i) => write(doc, cell, cellX(i), y, { align: align(i) }));
    y += 5.5;
  }

  if (footer) {
    doc.setDrawColor(210);
    doc.line(MARGIN, y - 3.5, MARGIN + usable, y - 3.5);
    doc.setFont('helvetica', 'bold');
    footer.forEach((cell, i) => write(doc, cell, cellX(i), y, { align: align(i) }));
    doc.setFont('helvetica', 'normal');
    y += 5.5;
  }

  return y;
}
