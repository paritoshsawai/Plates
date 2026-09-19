import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_CONFIG,
  formatCurrency,
  formatCurrencyAscii,
  isPlaceholderPricing,
  normalizePriceConfig,
  toPdfSafeText,
} from '../pricing';

describe('normalizePriceConfig', () => {
  it('fills in a missing config with the seeded defaults', () => {
    expect(normalizePriceConfig(null)).toEqual(DEFAULT_PRICE_CONFIG);
  });

  it('does not share the panel price object with the defaults', () => {
    const config = normalizePriceConfig(null);
    config.panelUnitPrice['4x10'] = 999;
    expect(DEFAULT_PRICE_CONFIG.panelUnitPrice['4x10']).toBe(20);
  });

  it('rejects negative and non-numeric prices from storage', () => {
    const config = normalizePriceConfig({
      panelUnitPrice: { '4x10': -50, '2x10': 'abc' as unknown as number },
      taxPercent: -1,
    });
    expect(config.panelUnitPrice['4x10']).toBe(20);
    expect(config.panelUnitPrice['2x10']).toBe(10);
    expect(config.taxPercent).toBe(0);
  });

  it('keeps a real schedule intact', () => {
    const config = normalizePriceConfig({
      effectiveDate: '2026-04-01',
      panelUnitPrice: { '4x10': 3500, '2x10': 2100 },
      taxPercent: 18,
    });
    expect(config.panelUnitPrice).toEqual({ '4x10': 3500, '2x10': 2100 });
    expect(config.taxPercent).toBe(18);
  });
});

describe('isPlaceholderPricing', () => {
  it('flags the seeded schedule and clears once an admin dates one', () => {
    expect(isPlaceholderPricing(DEFAULT_PRICE_CONFIG)).toBe(true);
    expect(isPlaceholderPricing({ ...DEFAULT_PRICE_CONFIG, effectiveDate: '2026-04-01' })).toBe(
      false,
    );
  });
});

describe('currency formatting', () => {
  it('uses the rupee sign on screen', () => {
    expect(formatCurrency(70000)).toContain('₹');
  });

  it('uses an ASCII form for the PDF, which has no rupee glyph', () => {
    expect(formatCurrencyAscii(70000)).toBe('INR 70,000.00');
    expect(formatCurrencyAscii(70000)).toMatch(/^[\x20-\x7E]+$/);
  });

  it('survives a non-finite amount rather than printing NaN', () => {
    expect(formatCurrencyAscii(Number.NaN)).toBe('INR 0.00');
  });
});

describe('toPdfSafeText', () => {
  it('folds smart quotes and dashes to ASCII', () => {
    expect(toPdfSafeText('Arplace’s “Unit A” – phase 2')).toBe(
      'Arplace\'s "Unit A" - phase 2',
    );
  });

  it('spells out the rupee sign', () => {
    expect(toPdfSafeText('₹3,500')).toBe('INR 3,500');
  });

  it('drops characters the built-in fonts cannot draw', () => {
    // A Devanagari plan name would otherwise corrupt the whole line.
    expect(toPdfSafeText('Plan अ A')).toBe('Plan  A');
  });

  it('leaves plain ASCII untouched', () => {
    expect(toPdfSafeText('Wall panel 4 ft x 10 ft')).toBe('Wall panel 4 ft x 10 ft');
  });
});
