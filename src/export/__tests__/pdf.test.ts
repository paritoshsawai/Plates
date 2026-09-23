import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { buildQuotePdf, contentBottom, fitsOnPage } from '../pdf';
import { buildBom } from '../../core/bom';
import { createPlan } from '../../core/plan';
import { validatePlan } from '../../core/validation';
import { DEFAULT_PRICE_CONFIG, formatCurrencyAscii } from '../../core/pricing';
import { tileRun } from '../../core/tiling';
import type { Panel, PriceConfig } from '../../core/types';

/**
 * The quote document.
 *
 * These are the first tests this file has had, and they exist because it had a
 * defect no amount of reading caught: it walked one `y` cursor down the page and
 * never compared it to the page height. jsPDF neither clips nor paginates, so a
 * real bill of materials was written past the bottom edge - the grand total, the
 * estimate and the utilisation report all drawn onto a sheet that ends above
 * them.
 *
 * That is why these assertions are about *position*, not presence. Text drawn
 * off the page is still in the content stream, so "the document mentions the
 * total" passes on a document nobody can read it in. PDF space has its origin
 * at the bottom-left, so content pushed past the bottom lands at a negative
 * `y` - which is what is checked below.
 */

const A4_HEIGHT_MM = 297;
const A4_HEIGHT_PT = 841.89;

interface TextItem {
  x: number;
  y: number;
  text: string;
}

/** Every string jsPDF drew, with where it drew it, in PDF points. */
function textItems(pdf: Uint8Array): TextItem[] {
  const raw = Buffer.from(pdf);
  const latin = raw.toString('latin1');
  const opener = /stream\r?\n/g;
  const items: TextItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = opener.exec(latin)) !== null) {
    const body = match.index + match[0].length;
    const end = latin.indexOf('endstream', body);
    if (end < 0) break;
    // Trim the newline before `endstream`; zlib rejects trailing bytes.
    let stop = end;
    while (stop > body && (raw[stop - 1] === 0x0a || raw[stop - 1] === 0x0d)) stop--;
    try {
      const content = inflateSync(raw.subarray(body, stop)).toString('latin1');
      // jsPDF writes `x y Td` and then `(text) Tj`.
      for (const m of content.matchAll(/([-\d.]+)\s+([-\d.]+)\s+Td\s*\n?\((.*?)\)\s*Tj/gs)) {
        items.push({ x: Number(m[1]), y: Number(m[2]), text: m[3] });
      }
    } catch {
      // Not a Flate stream - an embedded image, say. Skip it.
    }
    // Resume past the whole `endstream` token. It ends in "stream", so a scan
    // that resumes any earlier matches inside it and swallows the next page -
    // which is how this harness first read a two-page document as one page.
    opener.lastIndex = end + 'endstream'.length;
  }
  return items;
}

const allText = (items: TextItem[]) => items.map((i) => i.text).join('\n');
const onPage = (items: TextItem[]) => items.filter((i) => i.y >= 0 && i.y <= A4_HEIGHT_PT);

/** A 1x1 PNG, enough for jsPDF to reserve the drawing's full height. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A closed room, which gives walls and corners. */
function room(widthUnits: number, depthUnits: number): Panel[] {
  return [
    ...tileRun(0, 0, widthUnits, 'h')!,
    ...tileRun(0, depthUnits, widthUnits, 'h')!,
    ...tileRun(0, 0, depthUnits, 'v')!,
    ...tileRun(widthUnits, 0, depthUnits, 'v')!,
  ].map((panel, i) => ({ ...panel, id: `p${i}` }));
}

/**
 * A plan touching every category, which is as wide as a bill of materials gets.
 * The BOM groups by category and size, so more panels raise quantities rather
 * than adding rows - the row count is what fills the page, and it is bounded.
 */
function everyCategory(): Panel[] {
  const panels: Panel[] = room(10, 5).map((panel, i) =>
    i === 0 ? { ...panel, category: 'door' } : i === 1 ? { ...panel, category: 'window' } : panel,
  );
  for (let i = 0; i < 4; i++) {
    panels.push(
      { id: `f${i}`, category: 'floor', size: '4x10', x: i * 2, y: 0, orientation: 'h' },
      { id: `r${i}`, category: 'roof', size: '2x10', x: i * 2, y: 0, orientation: 'h' },
    );
  }
  return panels;
}

function quoteFor(
  panels: Panel[],
  config: PriceConfig = DEFAULT_PRICE_CONFIG,
  planImage: string | null = null,
) {
  const plan = { ...createPlan('Test plan'), panels };
  const bom = buildBom(panels, config);
  const doc = buildQuotePdf({
    plan,
    bom,
    priceConfig: config,
    validation: validatePlan(panels, plan.plot),
    planImage,
  });
  return { bom, doc, items: textItems(doc.output('arraybuffer') as ArrayBuffer as never) };
}

describe('fitsOnPage', () => {
  it('leaves room at the foot of the page for the footer', () => {
    expect(contentBottom(A4_HEIGHT_MM)).toBeLessThan(A4_HEIGHT_MM);
  });

  it('accepts a block that ends exactly on the boundary', () => {
    expect(fitsOnPage(contentBottom(A4_HEIGHT_MM) - 10, 10, A4_HEIGHT_MM)).toBe(true);
  });

  it('rejects a block that crosses it by a hair', () => {
    expect(fitsOnPage(contentBottom(A4_HEIGHT_MM) - 10, 10.1, A4_HEIGHT_MM)).toBe(false);
  });

  it('rejects anything starting past the boundary', () => {
    expect(fitsOnPage(contentBottom(A4_HEIGHT_MM) + 1, 0.1, A4_HEIGHT_MM)).toBe(false);
  });
});

describe('nothing is ever drawn off the sheet', () => {
  it('keeps every line of a small quote inside the page', () => {
    const { items } = quoteFor(room(6, 5));
    expect(items.length).toBeGreaterThan(0);
    expect(onPage(items)).toHaveLength(items.length);
  });

  it('keeps every line inside the page when the content overflows', () => {
    // The regression test. Before pagination this quote ran to roughly 380 mm
    // on a 297 mm sheet, which in PDF space puts the last lines at a negative
    // y - drawn, recorded in the file, and impossible to read.
    const { items } = quoteFor(everyCategory(), DEFAULT_PRICE_CONFIG, TINY_PNG);
    expect(items.filter((i) => i.y < 0 || i.y > A4_HEIGHT_PT)).toEqual([]);
  });

  it('spills onto a second page rather than off the first', () => {
    const { doc } = quoteFor(everyCategory(), DEFAULT_PRICE_CONFIG, TINY_PNG);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe('the quote carries its own total', () => {
  it('puts the grand total on the page for a small plan', () => {
    const { items, bom } = quoteFor(room(6, 5));
    expect(allText(onPage(items))).toContain(formatCurrencyAscii(bom.cost.total));
  });

  it('puts it on the page for a quote long enough to need two', () => {
    const { items, bom } = quoteFor(everyCategory(), DEFAULT_PRICE_CONFIG, TINY_PNG);
    expect(allText(onPage(items))).toContain(formatCurrencyAscii(bom.cost.total));
  });

  it('carries the utilisation report, which used to fall off with the total', () => {
    const { items } = quoteFor(everyCategory(), DEFAULT_PRICE_CONFIG, TINY_PNG);
    expect(allText(onPage(items))).toContain('Material utilisation');
  });

  it('repeats the column header on a continuation page', () => {
    // A continuation of bare figures under no headings is worse than no break.
    const { items } = quoteFor(everyCategory(), DEFAULT_PRICE_CONFIG, TINY_PNG);
    expect(onPage(items).filter((i) => i.text === 'Line total').length).toBeGreaterThan(1);
  });
});

describe('page economy', () => {
  it('does not add a blank page for a plan that fits', () => {
    expect(quoteFor(room(6, 5)).doc.getNumberOfPages()).toBe(1);
  });

  it('numbers every page', () => {
    const { doc, items } = quoteFor(everyCategory(), DEFAULT_PRICE_CONFIG, TINY_PNG);
    const total = doc.getNumberOfPages();
    const text = allText(onPage(items));
    expect(text).toContain(`Page 1 of ${total}`);
    expect(text).toContain(`Page ${total} of ${total}`);
  });
});

describe('the placeholder-pricing caveat', () => {
  it('appears while the schedule is still seeded', () => {
    expect(allText(onPage(quoteFor(room(6, 5)).items))).toContain('Indicative only');
  });

  it('goes away once a real schedule is entered', () => {
    // A schedule counts as real once it carries its own effective date, which
    // is what isPlaceholderPricing keys off - not the prices themselves.
    const real: PriceConfig = { ...DEFAULT_PRICE_CONFIG, effectiveDate: '2026-04-01' };
    const text = allText(onPage(quoteFor(room(6, 5), real).items));
    expect(text).not.toContain('Indicative only');
    expect(text).toContain('Price schedule effective');
  });
});
