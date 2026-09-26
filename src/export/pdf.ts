/**
 * PDF quote: the plan drawing, the bill of materials and the costs.
 *
 * This is the document that leaves the building, so it carries the price
 * schedule's effective date and says so when prices are still the seeded
 * placeholders.
 *
 * Everything here lays out against a page-aware cursor. An earlier version
 * walked a single `y` down the sheet and never compared it to the page height,
 * and jsPDF neither clips nor paginates - it simply draws outside the page. A
 * real bill of materials ran to roughly 380 mm on a 297 mm sheet, so the total
 * row, the whole estimate and the utilisation report were written past the
 * bottom edge and lost. Quotes went out with no price on them. Every block
 * below therefore asks `ensureSpace` for room before it draws.
 */

import { jsPDF } from 'jspdf';
import { lineLinearFt } from '../core/bom';
import { plotAreaSqFt } from '../core/plot';
import { formatCurrencyAscii, isPlaceholderPricing, toPdfSafeText } from '../core/pricing';
import { WALL_HEIGHT_FT, formatArea, formatLength, toDisplay } from '../core/units';
import type { LengthUnit } from '../core/units';
import type { Bom, Plan, PriceConfig, ValidationResult } from '../core/types';

const MARGIN = 14;
/** Room reserved at the foot of every page for the footer rule and its line. */
const FOOTER_RESERVE = 14;

const ROW_HEIGHT = 5.5;
const HEADER_HEIGHT = 7;

/** One type scale, so the document does not drift into ad-hoc sizes. */
const TYPE = {
  title: 16,
  subtitle: 10,
  heading: 11,
  body: 9.5,
  table: 8.8,
  small: 8,
} as const;

const INK = {
  text: 0,
  muted: 110,
  faint: 150,
  rule: 205,
  strongRule: 120,
  headerFill: 241,
} as const;

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

/** The lowest `y` a block may occupy before it has to move to a new page. */
export function contentBottom(pageHeight: number): number {
  return pageHeight - MARGIN - FOOTER_RESERVE;
}

/**
 * Whether a block of `needed` mm starting at `y` still fits on the page.
 *
 * Split out from `ensureSpace` so the decision can be tested without building a
 * document: this predicate is the whole of the pagination bug.
 */
export function fitsOnPage(y: number, needed: number, pageHeight: number): boolean {
  return y + needed <= contentBottom(pageHeight);
}

/** Start a new page when the next block will not fit, and report the cursor. */
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (fitsOnPage(y, needed, pageHeight)) return y;
  doc.addPage();
  return MARGIN;
}

/** A table cell whose unit is named by its column header, so the cell is bare. */
function formatLinear(ft: number | null, unit: LengthUnit): string {
  if (ft === null) return '';
  return String(Math.round(toDisplay(ft, unit) * 100) / 100);
}

export interface QuoteInput {
  plan: Plan;
  bom: Bom;
  priceConfig: PriceConfig;
  validation: ValidationResult;
  /** PNG data URL of the canvas, or null when the drawing is unavailable. */
  planImage: string | null;
  /**
   * The unit the quote reads in. Measured quantities convert; the SKU column
   * does not - `4x10` is the part number the factory picks, not a dimension.
   */
  unit?: LengthUnit;
}

export function buildQuotePdf({
  plan,
  bom,
  priceConfig,
  validation,
  planImage,
  unit = 'ft',
}: QuoteInput): jsPDF {
  // compress keeps the embedded plan bitmap from dominating the file size.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const usable = pageWidth - MARGIN * 2;
  let y = MARGIN;

  // --- Masthead ------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TYPE.title);
  write(doc, 'Arplace Panel Studio', MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TYPE.subtitle);
  doc.setTextColor(INK.muted);
  write(doc, 'Panel layout, bill of materials and estimate', MARGIN, y);
  doc.setTextColor(INK.text);
  y += 7;

  doc.setDrawColor(INK.strongRule);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  doc.setLineWidth(0.2);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TYPE.heading + 1);
  write(doc, plan.name, MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TYPE.small);
  doc.setTextColor(INK.muted);
  write(doc, `Version ${plan.version}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 4.5;
  write(doc, `Generated ${new Date().toLocaleString('en-IN')}`, MARGIN, y);
  y += 4.5;

  // A quote with unresolved errors says so, but as a line of text rather than
  // the full-width red bar this used to open with. The document still cannot
  // be mistaken for a buildable layout; it just no longer looks like a fault
  // report before the reader reaches the drawing.
  if (!validation.manufacturable) {
    doc.setFont('helvetica', 'bold');
    write(doc, 'Draft - this layout still has validation errors to resolve.', MARGIN, y);
    doc.setFont('helvetica', 'normal');
    y += 4.5;
  }
  doc.setTextColor(INK.text);
  y += 4;

  // --- Drawing -------------------------------------------------------------
  if (planImage) {
    // Fit inside the box, preserving the aspect ratio. Clamping the height
    // while leaving the width at full bleed - which is what this did - squashes
    // a tall plan horizontally, so a narrow deep building came out looking like
    // a different building.
    const boxHeight = 100;
    const props = doc.getImageProperties(planImage);
    const aspect = props.width / props.height;

    let imageWidth = usable;
    let imageHeight = imageWidth / aspect;
    if (imageHeight > boxHeight) {
      imageHeight = boxHeight;
      imageWidth = imageHeight * aspect;
    }
    // Centre what is narrower than the page, so the drawing does not sit off
    // to one side of its own frame.
    const imageX = MARGIN + (usable - imageWidth) / 2;

    y = ensureSpace(doc, y, imageHeight + 8);
    doc.addImage(planImage, 'PNG', imageX, y, imageWidth, imageHeight, undefined, 'FAST');
    doc.setDrawColor(INK.rule);
    doc.rect(imageX, y, imageWidth, imageHeight);
    y += imageHeight + 9;
  }

  // --- Site ----------------------------------------------------------------
  y = section(doc, y, pageWidth, 'Site', 3);
  y = keyValues(doc, y, pageWidth, [
    ['Plot area', formatArea(plotAreaSqFt(plan.plot), unit)],
    ['Wall height', formatLength(WALL_HEIGHT_FT, unit)],
    ['Wall length', formatLength(bom.utilization.linearFt, unit)],
  ]);
  y += 5;

  // --- Bill of materials ---------------------------------------------------
  y = section(doc, y, pageWidth, 'Bill of materials', 3);
  y = table(doc, y, pageWidth, {
    headers: ['SKU', 'Description', 'Qty', `Linear ${unit}`, 'Unit price', 'Line total'],
    // Each category carries its own subtotal, so a quote reads as wall, floor
    // and roof rather than one undifferentiated list.
    rows: bom.groups.flatMap((group) => [
      ...group.lines.map((line) => ({
        cells: [
          line.sku,
          line.description,
          String(line.qty),
          formatLinear(lineLinearFt(line), unit),
          formatCurrencyAscii(line.unitPrice),
          formatCurrencyAscii(line.lineTotal),
        ],
      })),
      {
        cells: [
          '',
          `${group.label} subtotal`,
          String(group.qty),
          '',
          '',
          formatCurrencyAscii(group.subtotal),
        ],
        emphasis: true,
      },
    ]),
    footer: [
      '',
      'Total',
      String(bom.totalPanels + bom.totalConnectors),
      formatLinear(bom.utilization.linearFt, unit),
      '',
      formatCurrencyAscii(bom.cost.panels + bom.cost.connectors),
    ],
  });
  y += 7;

  // --- Estimate ------------------------------------------------------------
  // A price table in everything but name, so it is ruled like one.
  y = section(doc, y, pageWidth, 'Estimate', 3);
  const costRows: Array<{ cells: string[]; emphasis?: boolean }> = [
    { cells: ['Panels', formatCurrencyAscii(bom.cost.panels)] },
  ];
  if (bom.cost.connectors)
    costRows.push({ cells: ['Connectors', formatCurrencyAscii(bom.cost.connectors)] });
  if (bom.cost.labor) costRows.push({ cells: ['Labor', formatCurrencyAscii(bom.cost.labor)] });
  if (bom.cost.transport)
    costRows.push({ cells: ['Transport', formatCurrencyAscii(bom.cost.transport)] });
  if (bom.cost.tax)
    costRows.push({
      cells: [`Tax (${priceConfig.taxPercent}%)`, formatCurrencyAscii(bom.cost.tax)],
    });

  y = table(doc, y, pageWidth, {
    headers: ['Item', 'Amount'],
    weights: [0.7, 0.3],
    rightAligned: [1],
    rows: costRows,
    footer: ['Total', formatCurrencyAscii(bom.cost.total)],
  });
  y += 3;

  // The placeholder caveat sits with the number it qualifies, where anyone
  // reading the total cannot miss it.
  y = ensureSpace(doc, y, 10);
  doc.setFontSize(TYPE.small);
  doc.setTextColor(INK.muted);
  const priceNote = isPlaceholderPricing(priceConfig)
    ? `Indicative only - the price schedule is still the seeded placeholder. Effective ${bom.priceEffectiveDate}. ${priceConfig.note}`
    : `Price schedule effective ${bom.priceEffectiveDate}. ${priceConfig.note}`;
  write(doc, priceNote, MARGIN, y, { maxWidth: usable });
  doc.setTextColor(INK.text);
  y += 10;

  // --- Material utilisation ------------------------------------------------
  y = section(doc, y, pageWidth, 'Material utilisation', 3);
  keyValues(doc, y, pageWidth, [
    [
      'Offcut produced',
      `${formatLength(bom.utilization.offcutFt, unit)} - panels are laid whole, never cut`,
    ],
    ['Offcut avoided vs cut-to-fit', formatLength(bom.utilization.offcutAvoidedFt, unit)],
    [
      'Panel optimality',
      `${Math.round(bom.utilization.optimalityPercent)}% (${bom.utilization.panelCount} placed, ${bom.utilization.optimalPanelCount} is the minimum)`,
    ],
  ]);

  drawFooters(doc, plan);
  return doc;
}

/**
 * Footers last, because "Page 1 of 4" needs a count only the finished document
 * has.
 */
function drawFooters(doc: jsPDF, plan: Plan): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  const baseline = pageHeight - MARGIN + 2;

  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setDrawColor(INK.rule);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, baseline - 4, pageWidth - MARGIN, baseline - 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TYPE.small);
    doc.setTextColor(INK.faint);
    write(doc, `${plan.name} - version ${plan.version}`, MARGIN, baseline);
    write(doc, `Page ${page} of ${total}`, pageWidth - MARGIN, baseline, { align: 'right' });
    doc.setTextColor(INK.text);
  }
}

/**
 * A section heading with a rule under it.
 *
 * `rowsBelow` is how many rows follow, so the heading moves to the next page
 * with them rather than being orphaned alone at the foot of this one.
 */
function section(
  doc: jsPDF,
  y: number,
  pageWidth: number,
  title: string,
  rowsBelow = 0,
): number {
  const next = ensureSpace(doc, y, 7 + rowsBelow * ROW_HEIGHT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TYPE.heading);
  write(doc, title, MARGIN, next);
  doc.setDrawColor(INK.strongRule);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, next + 1.6, pageWidth - MARGIN, next + 1.6);
  doc.setLineWidth(0.2);
  doc.setFont('helvetica', 'normal');
  return next + 6.5;
}

function keyValues(
  doc: jsPDF,
  startY: number,
  pageWidth: number,
  rows: Array<[string, string]>,
): number {
  doc.setFontSize(TYPE.body);
  let y = startY;
  for (const [label, value] of rows) {
    y = ensureSpace(doc, y, ROW_HEIGHT);
    write(doc, label, MARGIN, y);
    write(doc, value, pageWidth - MARGIN, y, { align: 'right' });
    y += ROW_HEIGHT;
  }
  return y;
}

interface TableRow {
  cells: string[];
  /** Subtotal rows: bolder, with a rule above separating them from the lines. */
  emphasis?: boolean;
}

interface TableSpec {
  headers: string[];
  rows: TableRow[];
  footer?: string[];
  /** Column widths as fractions of the usable width. Defaults to the BOM's. */
  weights?: number[];
  /** Column indices to right-align. Defaults to the BOM's numeric columns. */
  rightAligned?: number[];
}

/**
 * A ruled table that breaks across pages.
 *
 * Every row gets a hairline and every column a vertical rule, because a BOM is
 * twenty rows of figures and without them the eye loses its place between the
 * SKU and the line total. The column header repeats after each break - a
 * continuation of bare numbers under no headings is worse than no break at all.
 */
function table(doc: jsPDF, startY: number, pageWidth: number, spec: TableSpec): number {
  const usable = pageWidth - MARGIN * 2;
  const weights = spec.weights ?? [0.12, 0.34, 0.09, 0.13, 0.16, 0.16];
  const rightAligned = new Set(spec.rightAligned ?? [2, 3, 4, 5]);

  const xs: number[] = [];
  let cursor = MARGIN;
  for (const weight of weights) {
    xs.push(cursor);
    cursor += usable * weight;
  }
  const colRight = (i: number) => xs[i] + usable * weights[i];
  const cellX = (i: number) => (rightAligned.has(i) ? colRight(i) - 2 : xs[i] + 2);
  const align = (i: number) => (rightAligned.has(i) ? 'right' : 'left');

  /** Header band. Returns the baseline for the first body row. */
  const drawHeader = (top: number): number => {
    doc.setFillColor(INK.headerFill, 245, 249);
    doc.rect(MARGIN, top, usable, HEADER_HEIGHT, 'F');
    doc.setDrawColor(INK.strongRule);
    doc.rect(MARGIN, top, usable, HEADER_HEIGHT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TYPE.table);
    spec.headers.forEach((header, i) =>
      write(doc, header, cellX(i), top + HEADER_HEIGHT - 2.3, { align: align(i) }),
    );
    doc.setFont('helvetica', 'normal');
    return top + HEADER_HEIGHT;
  };

  /** Vertical rules for one band of rows, drawn once the band's height is known. */
  const drawColumnRules = (top: number, bottom: number) => {
    if (bottom <= top) return;
    doc.setDrawColor(INK.rule);
    for (let i = 1; i < weights.length; i++) doc.line(xs[i], top, xs[i], bottom);
    doc.line(MARGIN, top, MARGIN, bottom);
    doc.line(MARGIN + usable, top, MARGIN + usable, bottom);
  };

  let top = ensureSpace(doc, startY, HEADER_HEIGHT + ROW_HEIGHT * 2);
  let bandTop = top;
  let y = drawHeader(top);
  doc.setFontSize(TYPE.table);

  const renderRow = (cells: string[], emphasis: boolean) => {
    if (emphasis) {
      doc.setDrawColor(INK.strongRule);
      doc.line(MARGIN, y, MARGIN + usable, y);
      doc.setFont('helvetica', 'bold');
    }
    cells.forEach((cell, i) => write(doc, cell, cellX(i), y + ROW_HEIGHT - 1.8, { align: align(i) }));
    y += ROW_HEIGHT;
    doc.setDrawColor(INK.rule);
    doc.line(MARGIN, y, MARGIN + usable, y);
    if (emphasis) doc.setFont('helvetica', 'normal');
  };

  for (const row of spec.rows) {
    if (!fitsOnPage(y, ROW_HEIGHT, doc.internal.pageSize.getHeight())) {
      drawColumnRules(bandTop, y);
      doc.addPage();
      bandTop = MARGIN;
      y = drawHeader(MARGIN);
      doc.setFontSize(TYPE.table);
    }
    renderRow(row.cells, row.emphasis === true);
  }

  if (spec.footer) {
    if (!fitsOnPage(y, ROW_HEIGHT, doc.internal.pageSize.getHeight())) {
      drawColumnRules(bandTop, y);
      doc.addPage();
      bandTop = MARGIN;
      y = drawHeader(MARGIN);
      doc.setFontSize(TYPE.table);
    }
    doc.setDrawColor(INK.strongRule);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, MARGIN + usable, y);
    doc.setLineWidth(0.2);
    doc.setFont('helvetica', 'bold');
    spec.footer.forEach((cell, i) =>
      write(doc, cell, cellX(i), y + ROW_HEIGHT - 1.8, { align: align(i) }),
    );
    y += ROW_HEIGHT;
    doc.setDrawColor(INK.strongRule);
    doc.line(MARGIN, y, MARGIN + usable, y);
    doc.setFont('helvetica', 'normal');
  }

  drawColumnRules(bandTop, y);
  return y;
}
