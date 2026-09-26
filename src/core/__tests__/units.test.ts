import { describe, expect, it } from 'vitest';
import {
  GRID_FT,
  M_PER_FT,
  areaToDisplay,
  formatArea,
  formatLength,
  fromDisplay,
  inputMin,
  moduleLabel,
  toDisplay,
  toInputValue,
} from '../units';
import { plotAreaSqFt, plotEdgeLengthsFt, rectPlotFromFt } from '../plot';

/**
 * Feet or metres.
 *
 * The rule the whole feature rests on: a *measured* quantity converts, a
 * *product* fact does not. Arplace makes a 4 ft panel on a 2 ft module in
 * every unit, so the module is still 2 ft when the screen says metres - what
 * changes is how a plot, an area and a wall run are read and typed.
 */

describe('conversion', () => {
  it('round-trips a length through metres and back', () => {
    for (const ft of [2, 10, 40, 61, 137.5]) {
      expect(fromDisplay(toDisplay(ft, 'm'), 'm')).toBeCloseTo(ft, 9);
    }
  });

  it('leaves feet alone in both directions', () => {
    expect(toDisplay(40, 'ft')).toBe(40);
    expect(fromDisplay(40, 'ft')).toBe(40);
  });

  it('uses the international foot', () => {
    expect(M_PER_FT).toBe(0.3048);
    expect(toDisplay(1, 'm')).toBe(0.3048);
  });

  it('converts area by the square of the length factor', () => {
    // The mistake worth a test: converting an area with the length factor
    // would report a 2,400 sq ft plot as 731 m2 instead of 222.97 m2.
    expect(areaToDisplay(2400, 'm')).toBeCloseTo(2400 * 0.3048 * 0.3048, 6);
    expect(areaToDisplay(2400, 'm')).toBeCloseTo(222.97, 2);
  });
});

describe('the module stays 2 ft in both units', () => {
  it('is 0.6096 m, which is why metric sizes are never round', () => {
    expect(toDisplay(GRID_FT, 'm')).toBeCloseTo(0.6096, 9);
  });

  it('names itself in feet, with the metric size alongside for a metric reader', () => {
    expect(moduleLabel('ft')).toBe('2 ft');
    expect(moduleLabel('m')).toContain('2 ft');
    expect(moduleLabel('m')).toContain('0.61 m');
  });

  it('never lets a dimension input floor below one real module', () => {
    // 0.6096 m rounded *down* to 0.6 m would accept a sub-module dimension.
    expect(inputMin('ft')).toBe(GRID_FT);
    expect(fromDisplay(inputMin('m'), 'm')).toBeGreaterThanOrEqual(GRID_FT);
  });
});

describe('formatting', () => {
  it('reads a length in the unit asked for', () => {
    expect(formatLength(26, 'ft')).toBe('26 ft');
    expect(formatLength(26, 'm')).toBe('7.92 m');
  });

  it('defaults to feet, so an uninterested caller need not say', () => {
    expect(formatLength(26)).toBe('26 ft');
  });

  it('keeps two decimals in metres, which one decimal would collapse', () => {
    // 58 ft and 60 ft are two different buildable sizes. At one decimal they
    // would both print as 17.7 m / 18.3 m apart - but 0.6096 m steps mean
    // neighbouring sizes differ in the second decimal all over the range.
    expect(formatLength(58, 'm')).not.toBe(formatLength(60, 'm'));
    expect(formatLength(2, 'm')).toBe('0.61 m');
  });

  it('reads an area with the right unit symbol', () => {
    expect(formatArea(2400, 'ft')).toBe('2,400 sq ft');
    expect(formatArea(2400, 'm')).toBe('222.97 m²');
  });

  it('groups a large area Indian-style', () => {
    expect(formatArea(1200000, 'ft')).toBe('12,00,000 sq ft');
  });
});

describe('toInputValue', () => {
  /**
   * The bug this exists for: 40 ft is 12.192 m. Pre-filling the Plot dialog
   * with 12.19 m applies as 39.99 ft, which floors onto the module at 38 ft -
   * so merely reopening the dialog and pressing Apply would shrink the plot by
   * a whole module. Rounding the pre-fill *up* keeps the error inside 0.01 m.
   */
  it('gives feet back unchanged', () => {
    expect(toInputValue(40, 'ft')).toBe(40);
  });

  it('never pre-fills below the true length', () => {
    for (const ft of [2, 4, 40, 58, 60, 96]) {
      expect(fromDisplay(toInputValue(ft, 'm'), 'm')).toBeGreaterThanOrEqual(ft);
    }
  });

  it('survives a reopen: the plot comes back the size it went in', () => {
    for (const [w, l] of [
      [60, 40],
      [58, 42],
      [20, 20],
      [96, 30],
    ]) {
      const plot = rectPlotFromFt(w, l);
      const [widthFt, lengthFt] = plotEdgeLengthsFt(plot);

      // What the dialog shows, then what Apply would do with it.
      const reapplied = rectPlotFromFt(
        fromDisplay(toInputValue(widthFt, 'm'), 'm'),
        fromDisplay(toInputValue(lengthFt, 'm'), 'm'),
      );
      expect(plotEdgeLengthsFt(reapplied).slice(0, 2)).toEqual([widthFt, lengthFt]);
    }
  });

  it('is only two decimals, so the box is readable', () => {
    expect(toInputValue(40, 'm')).toBe(12.2);
    expect(String(toInputValue(60, 'm')).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('typing a plot in metres', () => {
  it('still rounds down onto the module, never up', () => {
    // 18 m is 59.06 ft. The buildable answer is 58 ft, because the design area
    // must never exceed the parcel the surveyor measured.
    const plot = rectPlotFromFt(fromDisplay(18, 'm'), fromDisplay(18, 'm'));
    expect(plotEdgeLengthsFt(plot).slice(0, 2)).toEqual([58, 58]);
  });

  it('reports that plot area in square metres', () => {
    const plot = rectPlotFromFt(fromDisplay(18, 'm'), fromDisplay(12, 'm'));
    expect(formatArea(plotAreaSqFt(plot), 'm')).toMatch(/m²$/);
    // 58 ft x 38 ft = 2,204 sq ft = 204.76 m2.
    expect(areaToDisplay(plotAreaSqFt(plot), 'm')).toBeCloseTo(204.76, 2);
  });
});
