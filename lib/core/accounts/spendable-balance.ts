/**
 * The spendable balance: what spec §31 Q1, "How much money do I have?", is
 * answered with on the accounts list (M2-F01, docs/product/success-criteria.md
 * #1).
 *
 * It is also Safe to Spend's CurrentBalance term
 * (docs/domain/safe-to-spend.md#currentbalance): the sum over accounts that
 * are not excluded, with a credit card entering as its negative balance. M7
 * must call this rather than re-implement it, so the accounts total and the
 * Safe to Spend breakdown cannot disagree.
 */

import { assertSameCurrency, sumMinor } from '../money/arithmetic';
import type { Minor } from '../money/parse';
import type { Account } from '../types';

/**
 * Sums active accounts that are not excluded from Safe to Spend. Throws
 * MixedCurrencyError if a counted account is not in `currency`, the user's
 * profile currency.
 */
export function spendableBalanceMinor(
  accounts: readonly Account[],
  currency: string,
): Minor {
  const counted = accounts.filter(
    (account) => account.archivedAt === null && !account.excludeFromSafeToSpend,
  );
  assertSameCurrency(currency, counted, 'spendable balance');
  return sumMinor(counted.map((account) => account.balanceMinor));
}
