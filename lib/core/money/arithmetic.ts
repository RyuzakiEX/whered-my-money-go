/**
 * Money arithmetic: the slice of docs/domain/money-and-rounding.md#function-contract
 * the first total needs (M2-F01). The rest of that contract lands with the
 * first task that uses it.
 *
 * Every function is exact on integer minor units, and refuses rather than
 * guesses: a thrown error is a bug report, a plausible wrong number is a user
 * who trusted us and should not have.
 */

import type { Minor } from './parse';

export class MoneyError extends Error {
  override name = 'MoneyError';
}

/**
 * One currency per user for the MVP. A row in another currency is an error,
 * never a value to convert or silently add
 * (money-and-rounding.md#single-currency-per-user).
 */
export class MixedCurrencyError extends MoneyError {
  override name = 'MixedCurrencyError';

  constructor(
    readonly expected: string,
    readonly found: string,
    readonly context: string,
  ) {
    super(`${context}: expected ${expected}, found ${found}`);
  }
}

/**
 * The exact sum, `0` for an empty list. Checks that every value and the total
 * is a safe integer, so a leaked float or an overflow throws instead of
 * rounding quietly.
 */
export function sumMinor(values: readonly Minor[]): Minor {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(`not an integer minor amount: ${String(value)}`);
    }
    total += value;
  }
  if (!Number.isSafeInteger(total)) {
    throw new MoneyError('total exceeds the safe-integer ceiling');
  }
  return total;
}

/** Throws MixedCurrencyError on the first item not in `expected`. */
export function assertSameCurrency(
  expected: string,
  items: readonly { currency: string }[],
  context: string,
): void {
  const stray = items.find((item) => item.currency !== expected);
  if (stray) throw new MixedCurrencyError(expected, stray.currency, context);
}
