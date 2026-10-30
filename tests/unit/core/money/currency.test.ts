import { describe, expect, it } from 'vitest';

import {
  currencyExponent,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from '@/lib/core/money/currency';
import { formatMinor, parseMoneyToMinor } from '@/lib/core/money/parse';

/**
 * The MVP currency allowlist — PHP, USD, EUR, JPY (decided 2026-10-30) — and
 * per-currency parsing per docs/domain/money-and-rounding.md: strip the
 * markers of the PROFILE currency only; every other currency's marker is an
 * error, never something to strip.
 *
 * The same four codes are the `profiles_currency_allowed` check constraint.
 * If this list and that constraint ever differ, a user can hold a currency
 * one side refuses.
 */
describe('supported currencies', () => {
  it('is exactly the MVP allowlist, in a stable order', () => {
    expect(SUPPORTED_CURRENCIES).toEqual(['PHP', 'USD', 'EUR', 'JPY']);
  });

  it.each([
    ['PHP', 2],
    ['USD', 2],
    ['EUR', 2],
    ['JPY', 0],
  ] as const)('%s has a minor-unit exponent of %d', (code, exponent) => {
    expect(currencyExponent(code)).toBe(exponent);
  });

  it.each(['PHP', 'USD', 'EUR', 'JPY'])('recognises %s', (code) => {
    expect(isSupportedCurrency(code)).toBe(true);
  });

  it.each(['GBP', 'php', 'PH', '', 'XXX', 'PHPX'])('refuses %j', (code) => {
    expect(isSupportedCurrency(code)).toBe(false);
  });
});

describe('parseMoneyToMinor across currencies', () => {
  it.each([
    ['USD', '$1,234.50', 123_450],
    ['USD', 'US$1,234.50', 123_450],
    ['USD', 'USD 10', 1_000],
    ['USD', '1234.5', 123_450],
    ['EUR', '€1.234,50', 123_450],
    ['EUR', '1 234,50 €', 123_450],
    ['EUR', 'EUR 5', 500],
    ['JPY', '¥1,234', 1_234],
    ['JPY', '1234', 1_234],
    ['JPY', 'JPY 500', 500],
    ['JPY', '1.234', 1_234], // three trailing digits: grouping, as in PHP
    ['PHP', '₱1,234.50', 123_450], // unchanged
  ] as const)('%s: %s -> %d', (currency, input, expected) => {
    const result = parseMoneyToMinor(input, currency);
    expect(result).toEqual({ ok: true, minor: expected });
  });

  it.each<[currency: string, input: string, why: string]>([
    ['USD', '₱10', 'another supported currency'],
    ['USD', 'PHP 10', 'another supported code'],
    ['USD', 'S$10', 'a different dollar'],
    ['USD', 'A$10', 'a different dollar'],
    ['USD', '€10', 'euro'],
    ['EUR', '$10', 'dollar'],
    ['EUR', '£10', 'pound'],
    ['JPY', '$10', 'dollar'],
    ['JPY', '₱10', 'peso'],
    ['PHP', '$10', 'dollar, still foreign for PHP'],
    ['PHP', '¥10', 'yen, still foreign for PHP'],
    ['PHP', 'EUR 10', 'euro code'],
  ])('%s refuses %s (%s)', (currency, input) => {
    expect(parseMoneyToMinor(input, currency)).toEqual({
      ok: false,
      reason: 'foreign_currency',
    });
  });

  it('JPY has no minor unit: any decimal is too precise', () => {
    expect(parseMoneyToMinor('12.5', 'JPY')).toEqual({
      ok: false,
      reason: 'too_many_decimals',
    });
    expect(parseMoneyToMinor('¥12.50', 'JPY')).toEqual({
      ok: false,
      reason: 'too_many_decimals',
    });
  });

  it('refuses an unsupported profile currency outright', () => {
    expect(parseMoneyToMinor('10', 'GBP')).toEqual({
      ok: false,
      reason: 'foreign_currency',
    });
  });
});

describe('formatMinor across currencies', () => {
  it('formats JPY with no fraction digits, from whole-yen minor units', () => {
    const formatted = formatMinor(1_234, 'JPY');
    expect(formatted).toMatch(/1,234$/);
    expect(formatted).not.toMatch(/\./);
  });

  it.each(['USD', 'EUR'] as const)(
    '%s keeps two fraction digits',
    (currency) => {
      expect(formatMinor(123_450, currency)).toMatch(/1,234\.50$/);
    },
  );
});
