import { describe, expect, it } from 'vitest';

import { spendableBalanceMinor } from '@/lib/core/accounts/spendable-balance';
import { MixedCurrencyError } from '@/lib/core/money/arithmetic';
import type { Account } from '@/lib/core/types';

/**
 * The accounts list total (M2-F01) — spec §31 Q1, "How much money do I
 * have?", answered over spendable accounts (docs/product/success-criteria.md
 * #1). The same sum is Safe to Spend's CurrentBalance term
 * (docs/domain/safe-to-spend.md#currentbalance), so the two cannot disagree.
 */

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Cash',
    type: 'cash',
    currency: 'PHP',
    openingBalanceMinor: 0,
    balanceMinor: 0,
    excludeFromSafeToSpend: false,
    archivedAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

describe('spendableBalanceMinor', () => {
  it('is 0 with no accounts', () => {
    expect(spendableBalanceMinor([], 'PHP')).toBe(0);
  });

  it('sums the balances of spendable, active accounts', () => {
    const accounts = [
      account({ balanceMinor: 150_000 }),
      account({ type: 'bank', balanceMinor: 2_000_050 }),
      account({ type: 'ewallet', balanceMinor: 75_025 }),
    ];
    expect(spendableBalanceMinor(accounts, 'PHP')).toBe(2_225_075);
  });

  it('counts a credit card as the negative it is, never as available credit', () => {
    const accounts = [
      account({ balanceMinor: 1_000_000 }),
      account({ type: 'credit_card', balanceMinor: -350_000 }),
    ];
    expect(spendableBalanceMinor(accounts, 'PHP')).toBe(650_000);
  });

  it('leaves out an account excluded from Safe to Spend', () => {
    const accounts = [
      account({ balanceMinor: 100_000 }),
      account({
        type: 'savings',
        balanceMinor: 20_000_000,
        excludeFromSafeToSpend: true,
      }),
    ];
    expect(spendableBalanceMinor(accounts, 'PHP')).toBe(100_000);
  });

  it('leaves out an archived account, even when handed one', () => {
    const accounts = [
      account({ balanceMinor: 100_000 }),
      account({ balanceMinor: 5_000, archivedAt: '2026-11-01T01:00:00Z' }),
    ];
    expect(spendableBalanceMinor(accounts, 'PHP')).toBe(100_000);
  });

  it('refuses to add currencies together rather than return 42,500 of nothing', () => {
    const accounts = [
      account({ balanceMinor: 4_200_000 }),
      account({ currency: 'USD', balanceMinor: 50_000 }),
    ];
    expect(() => spendableBalanceMinor(accounts, 'PHP')).toThrow(
      MixedCurrencyError,
    );
  });

  it('ignores the currency of an account it does not count', () => {
    // An excluded or archived account in another currency does not enter the
    // sum, so it cannot corrupt it either.
    const accounts = [
      account({ balanceMinor: 100_000 }),
      account({
        currency: 'USD',
        balanceMinor: 50_000,
        excludeFromSafeToSpend: true,
      }),
      account({
        currency: 'JPY',
        balanceMinor: 9_000,
        archivedAt: '2026-11-01T01:00:00Z',
      }),
    ];
    expect(spendableBalanceMinor(accounts, 'PHP')).toBe(100_000);
  });
});
