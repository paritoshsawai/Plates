/**
 * Price configuration.
 *
 * Prices are never hard-coded into the pricing maths. They live here as an
 * admin-editable, dated schedule of rows so a quote can always be traced to
 * what produced it.
 *
 * The schedule is keyed by *category and size*, not size alone: a roof panel
 * and a wall panel share a 4 ft x 10 ft footprint but are different assemblies
 * with different cores and edge details, so they are separate SKUs. The seeded
 * numbers happen to be equal across categories today - nothing in the code may
 * assume that, which is why every row is independently editable.
 */

import { CONNECTOR_STYLE, PANEL_CATALOG, CATEGORY_STYLE, skuKey } from './panels';
import type { ConnectorType, PanelCategory, PriceCategory, PriceConfig, PriceRow } from './types';

const PLACEHOLDER_BY_SIZE: Record<string, number> = { '4x10': 20, '2x10': 10 };

/** Placeholder connector price, flat across junction types until Arplace differentiates. */
const PLACEHOLDER_CONNECTOR = 15;

function seedRows(): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const category of Object.keys(CATEGORY_STYLE) as PanelCategory[]) {
    for (const spec of PANEL_CATALOG) {
      rows.push({ category, size: spec.id, unitPrice: PLACEHOLDER_BY_SIZE[spec.id] ?? 0 });
    }
  }
  for (const type of Object.keys(CONNECTOR_STYLE) as ConnectorType[]) {
    rows.push({ category: 'connector', size: type, unitPrice: PLACEHOLDER_CONNECTOR });
  }
  return rows;
}

/**
 * Seed values only. The figures are the placeholders from the build spec, not
 * Arplace's real ex-works prices - an admin must replace them before any quote
 * leaves the building.
 */
export const DEFAULT_PRICE_CONFIG: PriceConfig = {
  currency: 'INR',
  effectiveDate: '1970-01-01',
  note: "PLACEHOLDER prices. Replace with Arplace's current schedule before quoting.",
  rows: seedRows(),
  laborPerPanel: 0,
  transportPerPanel: 0,
  transportFlat: 0,
  taxPercent: 0,
};

export function isPlaceholderPricing(config: PriceConfig): boolean {
  return config.effectiveDate === DEFAULT_PRICE_CONFIG.effectiveDate;
}

/** Unit price for one SKU. Missing rows price at 0 rather than throwing, so a
 * layout still costs out while an admin fills in a newly added category. */
export function priceOf(config: PriceConfig, category: PriceCategory, size: string): number {
  const row = config.rows.find((r) => r.category === category && r.size === size);
  return row ? row.unitPrice : 0;
}

/** The date a given SKU was priced from: its own, else the schedule's. */
export function priceDateOf(config: PriceConfig, category: PriceCategory, size: string): string {
  const row = config.rows.find((r) => r.category === category && r.size === size);
  return row?.effectiveDate || config.effectiveDate;
}

export function setPrice(
  config: PriceConfig,
  category: PriceCategory,
  size: string,
  unitPrice: number,
): PriceRow[] {
  const rows = config.rows.map((row) =>
    row.category === category && row.size === size ? { ...row, unitPrice } : row,
  );
  if (!rows.some((row) => row.category === category && row.size === size)) {
    rows.push({ category, size, unitPrice });
  }
  return rows;
}

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

const plainFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Currency without the rupee sign, for outputs that cannot render it.
 *
 * jsPDF's built-in fonts are WinAnsi-encoded and have no U+20B9, so a quote
 * using the symbol comes out as mojibake. "INR 70,000.00" is unambiguous and
 * standard on invoices, and costs no embedded font.
 */
export function formatCurrencyAscii(amount: number): string {
  return `INR ${plainFormatter.format(Number.isFinite(amount) ? amount : 0)}`;
}

/**
 * Fold typographic characters down to WinAnsi-safe ASCII. Plan names and the
 * admin's price note are free text, and a smart quote pasted from a document
 * would otherwise corrupt the whole string in the PDF.
 */
export function toPdfSafeText(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    .replace(/₹/g, 'INR ')
    // Anything still outside Latin-1 would switch jsPDF to an encoding its
    // built-in fonts cannot draw, so drop it rather than corrupt the line.
    .replace(/[^\x20-\x7E -ÿ]/g, '');
}

function coerceNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Fill in and sanitise a partial config, e.g. one loaded from storage.
 *
 * This is also the single migration point for schedules saved before panels had
 * categories: their flat `panelUnitPrice` map becomes the wall rows, and every
 * other category is seeded. `state/storage.ts` funnels every load through here,
 * so there is exactly one place old data can arrive.
 */
export function normalizePriceConfig(input: Partial<PriceConfig> | null | undefined): PriceConfig {
  const base = DEFAULT_PRICE_CONFIG;
  if (!input) return { ...base, rows: seedRows() };

  const seeded = seedRows();
  const byKey = new Map(seeded.map((row) => [skuKey(row.category, row.size), row]));

  // Pre-category schedules priced by size alone, and everything was a wall.
  const legacy = (input as { panelUnitPrice?: Record<string, unknown> }).panelUnitPrice;
  if (legacy && typeof legacy === 'object') {
    for (const [size, price] of Object.entries(legacy)) {
      const key = skuKey('wall', size);
      const existing = byKey.get(key);
      if (existing) existing.unitPrice = coerceNumber(price, existing.unitPrice);
    }
  }

  if (Array.isArray(input.rows)) {
    for (const raw of input.rows) {
      if (!raw || typeof raw !== 'object') continue;
      const category = String(raw.category) as PriceCategory;
      const size = String(raw.size);
      const key = skuKey(category, size);
      const existing = byKey.get(key);
      const unitPrice = coerceNumber(raw.unitPrice, existing?.unitPrice ?? 0);
      const effectiveDate =
        typeof raw.effectiveDate === 'string' && raw.effectiveDate ? raw.effectiveDate : undefined;
      byKey.set(key, { category, size, unitPrice, ...(effectiveDate ? { effectiveDate } : {}) });
    }
  }

  return {
    currency: 'INR',
    effectiveDate:
      typeof input.effectiveDate === 'string' && input.effectiveDate
        ? input.effectiveDate
        : base.effectiveDate,
    note: typeof input.note === 'string' ? input.note : base.note,
    rows: [...byKey.values()],
    laborPerPanel: coerceNumber(input.laborPerPanel, base.laborPerPanel),
    transportPerPanel: coerceNumber(input.transportPerPanel, base.transportPerPanel),
    transportFlat: coerceNumber(input.transportFlat, base.transportFlat),
    taxPercent: coerceNumber(input.taxPercent, base.taxPercent),
  };
}
