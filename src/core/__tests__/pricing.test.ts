import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_CONFIG,
  formatCurrency,
  formatCurrencyAscii,
  isPlaceholderPricing,
  normalizePriceConfig,
  priceDateOf,
  priceOf,
  setPrice,
  toPdfSafeText,
} from '../pricing';

describe('the seeded schedule', () => {
  it('prices every category separately even where the footprint matches', () => {
    // A roof panel and a wall panel are both 4 ft x 10 ft but are different
    // assemblies, so they must be independently addressable rows.
    for (const category of ['wall', 'floor', 'roof', 'door', 'window'] as const) {
      expect(priceOf(DEFAULT_PRICE_CONFIG, category, '4x10')).toBe(20);
      expect(priceOf(DEFAULT_PRICE_CONFIG, category, '2x10')).toBe(10);
    }
  });

  it('seeds a row for each junction type', () => {
    for (const type of ['corner', 't-junction', 'cross'] as const) {
      expect(priceOf(DEFAULT_PRICE_CONFIG, 'connector', type)).toBeGreaterThan(0);
    }
  });

  it('prices an unknown SKU at zero rather than throwing', () => {
    expect(priceOf(DEFAULT_PRICE_CONFIG, 'wall', '6x10')).toBe(0);
  });
});

describe('setPrice', () => {
  it('changes one row without disturbing the same size in another category', () => {
    const rows = setPrice(DEFAULT_PRICE_CONFIG, 'roof', '4x10', 4200);
    const config = { ...DEFAULT_PRICE_CONFIG, rows };
    expect(priceOf(config, 'roof', '4x10')).toBe(4200);
    expect(priceOf(config, 'wall', '4x10')).toBe(20);
    expect(priceOf(config, 'roof', '2x10')).toBe(10);
  });

  it('adds a row that does not exist yet', () => {
    const rows = setPrice(DEFAULT_PRICE_CONFIG, 'wall', '6x10', 99);
    expect(priceOf({ ...DEFAULT_PRICE_CONFIG, rows }, 'wall', '6x10')).toBe(99);
  });
});

describe('normalizePriceConfig', () => {
  it('fills in a missing config with the seeded defaults', () => {
    expect(normalizePriceConfig(null).rows).toEqual(DEFAULT_PRICE_CONFIG.rows);
  });

  it('does not share row objects with the defaults', () => {
    const config = normalizePriceConfig(null);
    config.rows[0].unitPrice = 999;
    expect(priceOf(DEFAULT_PRICE_CONFIG, 'wall', '4x10')).toBe(20);
  });

  it('migrates a pre-category schedule into the wall rows', () => {
    // Schedules saved before categories existed priced by size alone, and
    // every panel back then was a wall.
    const config = normalizePriceConfig({
      effectiveDate: '2026-04-01',
      panelUnitPrice: { '4x10': 3500, '2x10': 2100 },
    } as never);

    expect(priceOf(config, 'wall', '4x10')).toBe(3500);
    expect(priceOf(config, 'wall', '2x10')).toBe(2100);
    // The categories that schedule never knew about fall back to the seeds.
    expect(priceOf(config, 'roof', '4x10')).toBe(20);
    expect(config.effectiveDate).toBe('2026-04-01');
  });

  it('keeps a row schedule intact and seeds anything missing from it', () => {
    const config = normalizePriceConfig({
      effectiveDate: '2026-04-01',
      rows: [{ category: 'roof', size: '4x10', unitPrice: 4200 }],
    });
    expect(priceOf(config, 'roof', '4x10')).toBe(4200);
    expect(priceOf(config, 'wall', '4x10')).toBe(20);
  });

  it('rejects negative and non-numeric prices from storage', () => {
    const config = normalizePriceConfig({
      rows: [
        { category: 'wall', size: '4x10', unitPrice: -50 },
        { category: 'wall', size: '2x10', unitPrice: 'abc' as unknown as number },
      ],
      taxPercent: -1,
    });
    expect(priceOf(config, 'wall', '4x10')).toBe(20);
    expect(priceOf(config, 'wall', '2x10')).toBe(10);
    expect(config.taxPercent).toBe(0);
  });
});

describe('priceDateOf', () => {
  it('falls back to the schedule date', () => {
    expect(priceDateOf(DEFAULT_PRICE_CONFIG, 'wall', '4x10')).toBe(
      DEFAULT_PRICE_CONFIG.effectiveDate,
    );
  });

  it('lets one row carry its own date, so a single SKU can be re-priced', () => {
    const config = normalizePriceConfig({
      effectiveDate: '2026-01-01',
      rows: [{ category: 'roof', size: '4x10', unitPrice: 4200, effectiveDate: '2026-06-01' }],
    });
    expect(priceDateOf(config, 'roof', '4x10')).toBe('2026-06-01');
    expect(priceDateOf(config, 'wall', '4x10')).toBe('2026-01-01');
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
