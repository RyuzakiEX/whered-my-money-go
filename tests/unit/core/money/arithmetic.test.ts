import { describe, expect, it } from 'vitest';

import {
  assertSameCurrency,
  MixedCurrencyError,
  MoneyError,
  sumMinor,
} from '@/lib/core/money/arithmetic';

/**
 * The slice of docs/domain/money-and-rounding.md#function-contract that the
 * first total (M2-F01's accounts list) needs. The rest of the contract lands
 * with the first task that uses it.
 */
describe('sumMinor', () => {
  it('is 0 for an empty list, not an error', () => {
    expect(sumMinor([])).toBe(0);
  });

  it('adds exactly, with negatives (a card in debt)', () => {
    expect(sumMinor([150_000, 2_000_050, -1_200_000])).toBe(950_050);
  });

  it('never drifts the way float addition of the major amounts would', () => {
    // 0.1 + 0.2 !== 0.3 in floats; 10 + 20 === 30 in centavos.
    expect(sumMinor([10, 20])).toBe(30);
  });

  it('refuses a value that is not an integer — a float leaked in', () => {
    expect(() => sumMinor([100, 0.5])).toThrow(MoneyError);
  });

  it('refuses a total past the safe-integer ceiling', () => {
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyError);
  });
});

describe('assertSameCurrency', () => {
  it('passes for an empty list and for one currency throughout', () => {
    expect(() => {
      assertSameCurrency('PHP', [], 'test');
    }).not.toThrow();
    expect(() => {
      assertSameCurrency(
        'PHP',
        [{ currency: 'PHP' }, { currency: 'PHP' }],
        't',
      );
    }).not.toThrow();
  });

  it('throws on the first mismatch, naming both currencies and the site', () => {
    let caught: unknown;
    try {
      assertSameCurrency(
        'PHP',
        [{ currency: 'PHP' }, { currency: 'USD' }, { currency: 'JPY' }],
        'accounts total',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixedCurrencyError);
    expect(caught).toBeInstanceOf(MoneyError);
    expect(caught).toMatchObject({
      expected: 'PHP',
      found: 'USD',
      context: 'accounts total',
    });
  });
});
