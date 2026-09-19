/**
 * Price configuration.
 *
 * Prices are never hard-coded into the pricing maths. They live here as an
 * admin-editable, dated config so a quote can always be traced to the schedule
 * that produced it.
 */

import type { PriceConfig } from './types';

/**
 * Seed values only. The 20 / 10 figures are the placeholders from the build
 * spec, not Arplace's real ex-works prices - an admin must replace them before
 * any quote leaves the building.
 */
export const DEFAULT_PRICE_CONFIG: PriceConfig = {
  currency: 'INR',
  effectiveDate: '1970-01-01',
  note: "PLACEHOLDER prices. Replace with Arplace's current schedule before quoting.",
  panelUnitPrice: {
    '4x10': 20,
    '2x10': 10,
  },
  laborPerPanel: 0,
  transportPerPanel: 0,
  transportFlat: 0,
  taxPercent: 0,
};

export function isPlaceholderPricing(config: PriceConfig): boolean {
  return config.effectiveDate === DEFAULT_PRICE_CONFIG.effectiveDate;
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

/** Fill in and sanitise a partial config, e.g. one loaded from storage. */
export function normalizePriceConfig(input: Partial<PriceConfig> | null | undefined): PriceConfig {
  const base = DEFAULT_PRICE_CONFIG;
  if (!input) return { ...base, panelUnitPrice: { ...base.panelUnitPrice } };
  return {
    currency: 'INR',
    effectiveDate:
      typeof input.effectiveDate === 'string' && input.effectiveDate
        ? input.effectiveDate
        : base.effectiveDate,
    note: typeof input.note === 'string' ? input.note : base.note,
    panelUnitPrice: {
      '4x10': coerceNumber(input.panelUnitPrice?.['4x10'], base.panelUnitPrice['4x10']),
      '2x10': coerceNumber(input.panelUnitPrice?.['2x10'], base.panelUnitPrice['2x10']),
    },
    laborPerPanel: coerceNumber(input.laborPerPanel, base.laborPerPanel),
    transportPerPanel: coerceNumber(input.transportPerPanel, base.transportPerPanel),
    transportFlat: coerceNumber(input.transportFlat, base.transportFlat),
    taxPercent: coerceNumber(input.taxPercent, base.taxPercent),
  };
}
