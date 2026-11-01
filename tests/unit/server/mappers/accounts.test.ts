import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_COLUMNS,
  toDomainAccount,
} from '@/lib/server/mappers/accounts';

/**
 * M2-B05: the accounts mapper — the one place that knows the column names.
 * Pure, so it needs no database.
 */

const row = {
  id: '0b6f3a4e-8f1c-4c2a-9d3e-5a7b8c9d0e1f',
  name: 'GCash',
  type: 'ewallet',
  currency: 'PHP',
  opening_balance_minor: -125_050,
  exclude_from_safe_to_spend: true,
  archived_at: null,
  created_at: '2026-11-01T08:00:00+00:00',
} as const;

describe('toDomainAccount', () => {
  it('maps every column to its domain field', () => {
    expect(toDomainAccount(row, 99_000)).toEqual({
      id: row.id,
      name: 'GCash',
      type: 'ewallet',
      currency: 'PHP',
      openingBalanceMinor: -125_050,
      balanceMinor: 99_000,
      excludeFromSafeToSpend: true,
      archivedAt: null,
      createdAt: row.created_at,
    });
  });

  it('carries an archive time through', () => {
    const archivedAt = '2026-11-02T01:00:00+00:00';
    expect(
      toDomainAccount({ ...row, archived_at: archivedAt }, 0).archivedAt,
    ).toBe(archivedAt);
  });

  it('throws on a currency outside the allowlist: that is a schema bug, not a UI state', () => {
    expect(() => toDomainAccount({ ...row, currency: 'GBP' }, 0)).toThrow(
      /currency/,
    );
  });

  it('selects exactly the columns it maps, never *', () => {
    expect(
      ACCOUNT_COLUMNS.split(',')
        .map((c) => c.trim())
        .sort(),
    ).toEqual(Object.keys(row).sort());
  });
});
