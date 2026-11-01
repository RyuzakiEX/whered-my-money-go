// Account rows -> the Account domain type (M2-B05).
//
// MAY BE IMPORTED BY: lib/server/**.
//
// The only place that knows the `accounts` column names: queries select
// ACCOUNT_COLUMNS and hand rows here, so no generated row type escapes into
// lib/core or components (docs/architecture/api-and-data-access.md#mapper-discipline).

import { isSupportedCurrency } from '@/lib/core/money/currency';
import type { Minor } from '@/lib/core/money/parse';
import type { Account } from '@/lib/core/types';
import type { Tables } from '@/types/database';

/** Named columns, never `*`: a column added later must not flow out unasked. */
export const ACCOUNT_COLUMNS =
  'id, name, type, currency, opening_balance_minor, exclude_from_safe_to_spend, archived_at, created_at';

export type AccountRow = Pick<
  Tables<'accounts'>,
  | 'id'
  | 'name'
  | 'type'
  | 'currency'
  | 'opening_balance_minor'
  | 'exclude_from_safe_to_spend'
  | 'archived_at'
  | 'created_at'
>;

/**
 * `balanceMinor` is supplied by the caller, because it is not a column: it is
 * derived from the ledger (docs/adr/0007-derived-account-balances.md).
 */
export function toDomainAccount(row: AccountRow, balanceMinor: Minor): Account {
  // accounts_currency_allowed guarantees this; reaching the throw is a schema
  // bug, and a wrong currency would mis-format every amount on the account.
  if (!isSupportedCurrency(row.currency)) {
    throw new Error(`account has an unsupported currency: ${row.currency}`);
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalanceMinor: row.opening_balance_minor,
    balanceMinor,
    excludeFromSafeToSpend: row.exclude_from_safe_to_spend,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}
