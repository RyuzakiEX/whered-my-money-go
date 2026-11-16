import { describe, expect, it } from 'vitest';

import {
  currencyExponent,
  SUPPORTED_CURRENCIES,
} from '@/lib/core/money/currency';
import { parseMoneyToMinor } from '@/lib/core/money/parse';
import { formatMoney } from '@/lib/utils/format-money';

/**
 * The display edge for money (docs/domain/money-and-rounding.md#display-formatting).
 * ICU builds differ in spacing, so the table normalises non-breaking spaces.
 */
const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('formatMoney', () => {
  it.each([
    [2_350_000, {}, '₱23,500.00'],
    [2_350_000, { compactZeroFraction: true }, '₱23,500'],
    [2_350_050, { compactZeroFraction: true }, '₱23,500.50'],
    [3_500_000, { signDisplay: 'always' }, '+₱35,000.00'],
    [-1_500_000, {}, '-₱15,000.00'],
    [-1_500_000, { signDisplay: 'always' }, '-₱15,000.00'],
    [0, {}, '₱0.00'],
    [0, { signDisplay: 'always' }, '₱0.00'],
    [-0, {}, '₱0.00'],
    [1, {}, '₱0.01'],
  ] as const)('PHP %d %j -> %s', (minor, opts, expected) => {
    expect(plain(formatMoney(minor, 'PHP', opts))).toBe(expected);
  });

  it('shows ₱ for PHP, not the code, in every locale it is asked for', () => {
    expect(formatMoney(100, 'PHP', { locale: 'en-US' })).toContain('₱');
  });

  it('gives JPY no phantom minor unit', () => {
    expect(plain(formatMoney(1_234, 'JPY'))).toMatch(/^￥1,234$|^¥1,234$/);
  });

  it.each(SUPPORTED_CURRENCIES)(
    'uses the same number of decimals as the parser for %s',
    (currency) => {
      const formatted = formatMoney(123_456, currency);
      const decimals = /\.(\d+)$/.exec(formatted)?.[1]?.length ?? 0;
      expect(decimals).toBe(currencyExponent(currency));
    },
  );

  it.each(SUPPORTED_CURRENCIES)(
    'round-trips through the parser for %s (invariant M13)',
    (currency) => {
      for (const minor of [0, 1, 99, 123_456, -987_654_321]) {
        expect(
          parseMoneyToMinor(formatMoney(minor, currency), currency),
        ).toEqual({ ok: true, minor });
      }
    },
  );

  it('keeps differing options apart in its formatter cache', () => {
    const first = formatMoney(100, 'USD');
    expect(formatMoney(100, 'USD')).toBe(first);
    expect(formatMoney(100, 'USD', { signDisplay: 'always' })).not.toBe(first);
  });
});
