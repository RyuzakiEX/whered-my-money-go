import { describe, expect, it } from 'vitest';

import { formatMinor, parseMoneyToMinor } from '@/lib/core/money/parse';

/**
 * MONEY_FIXTURE_PARSE_TABLE — every row of the parsing table in
 * docs/domain/money-and-rounding.md#parsing-at-the-boundary.
 *
 * The doc is the specification; this table is its executable form. A new
 * locale bug gets a row here first and a fix second.
 */
describe('parseMoneyToMinor', () => {
  describe('accepts', () => {
    it.each([
      ['1234.5', 123_450, 'bare, one decimal place'],
      ['1234.50', 123_450, 'bare, two decimal places'],
      ['1,234.50', 123_450, 'en-PH thousands separator'],
      ['₱1,234.50', 123_450, 'symbol prefix'],
      ['PHP 1234.50', 123_450, 'ISO code prefix'],
      ['1.234,50', 123_450, 'de-DE style, from a pasted value'],
      ['1 234,50', 123_450, 'NBSP grouping'],
      ['1 234,50', 123_450, 'narrow NBSP grouping'],
      ['(1,234.50)', -123_450, 'accounting negative'],
      ['1234', 123_400, 'integer major units'],
      ['0.01', 1, 'smallest representable amount'],
      ['0', 0, 'zero is a valid amount'],
      ['-500', -50_000, 'leading minus'],
      ['+500', 50_000, 'leading plus is stripped'],
      ['1.234.567', 123_456_700, 'repeated separator, well-formed grouping'],
      ['(500)', -50_000, 'accounting negative, no separators'],
      ['.50', 50, 'bare decimal, no integer part'],
    ])('%s -> %d  (%s)', (input, expected) => {
      const result = parseMoneyToMinor(input, 'PHP');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.minor).toBe(expected);
    });

    // Step 4's ambiguous case. Three trailing digits can be grouping ("1,234")
    // or three decimals ("1234.567"). The integer part settles it: a grouping
    // separator appears every three digits from the right, so the first group
    // is 1..3 digits. A longer lead cannot be a group boundary.
    //
    // This resolved a contradiction between the doc's parsing TABLE (which
    // rejects "1234.567") and its ALGORITHM (which said 3 trailing digits are
    // always grouping). See the PR's Misalignments section.
    describe('three trailing digits — grouping vs decimals', () => {
      it.each([
        ['1,234', 123_400, 'short lead -> grouping'],
        ['1.234', 123_400, 'short lead, dot grouping'],
        ['999,999', 99_999_900, 'three-digit lead -> still grouping'],
      ])('%s -> %d  (%s)', (input, expected) => {
        const result = parseMoneyToMinor(input, 'PHP');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.minor).toBe(expected);
      });

      it.each([
        ['1234.567', 'four-digit lead cannot be a group'],
        ['12345.678', 'five-digit lead cannot be a group'],
      ])('%s rejects  (%s)', (input) => {
        const result = parseMoneyToMinor(input, 'PHP');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('too_many_decimals');
      });
    });
  });

  describe('rejects', () => {
    it.each([
      ['1234.567', 'too_many_decimals', 'more precision than PHP has'],
      ['1.2.3', 'ambiguous_separators', 'ambiguous'],
      ['', 'empty', 'required field, not zero'],
      ['   ', 'empty', 'whitespace only'],
      ['abc', 'not_a_number', 'not numeric'],
      ['12abc', 'not_a_number', 'trailing garbage'],
      ['$1,234.50', 'foreign_currency', 'symbol for another currency'],
      ['USD 10.00', 'foreign_currency', 'ISO code for another currency'],
      ['1.2345', 'too_many_decimals', 'four decimal places'],
      ['₱', 'empty', 'symbol with no digits'],
      ['()', 'empty', 'empty parentheses'],
      ['-', 'empty', 'sign with no digits'],
      ['.', 'too_many_decimals', 'lone separator has no digits to parse'],
      ['1.2.3.4', 'ambiguous_separators', 'repeated, malformed groups'],
      [
        '12.34.56',
        'ambiguous_separators',
        'first group too long to be grouping',
      ],
    ])('%s -> %s  (%s)', (input, reason) => {
      const result = parseMoneyToMinor(input, 'PHP');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    });

    it('rejects a value beyond the safe-integer ceiling', () => {
      const result = parseMoneyToMinor('999999999999999999', 'PHP');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('out_of_range');
    });
  });

  // Step 7 of the algorithm. `Math.round(parseFloat("19.99") * 100)` happens
  // to be 1999, but the pattern is one refactor from Math.floor and 1998.
  // Parsing digit substrings makes the whole class of error impossible.
  describe('never routes through a float', () => {
    it.each([
      ['19.99', 1999],
      ['0.07', 7],
      ['8.11', 811],
      ['29.97', 2997],
    ])('%s parses exactly', (input, expected) => {
      const result = parseMoneyToMinor(input, 'PHP');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.minor).toBe(expected);
    });
  });

  describe('round-trips with formatMinor', () => {
    it.each([123_450, 1, 0, -50_000, 999_999_99])(
      '%d survives format -> parse',
      (minor) => {
        const formatted = formatMinor(minor, 'PHP');
        const reparsed = parseMoneyToMinor(formatted, 'PHP');
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) expect(reparsed.minor).toBe(minor);
      },
    );
  });
});

describe('formatMinor', () => {
  it.each([
    [123_450, '₱1,234.50'],
    [0, '₱0.00'],
    [1, '₱0.01'],
    [-123_450, '-₱1,234.50'],
    [100_000_000, '₱1,000,000.00'],
  ])('%d -> %s', (minor, expected) => {
    // Normalize the non-breaking space Intl may emit after the symbol.
    expect(formatMinor(minor, 'PHP').replace(/ /g, ' ').trim()).toBe(expected);
  });

  it('always shows exactly two decimal places for PHP', () => {
    expect(formatMinor(100, 'PHP')).toMatch(/1\.00$/);
    expect(formatMinor(110, 'PHP')).toMatch(/1\.10$/);
  });
});
