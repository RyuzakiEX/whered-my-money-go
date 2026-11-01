/**
 * Domain types: the product's model, shaped by the product rather than by
 * Postgres. Rows from types/database.types.ts are mapped into these in
 * lib/server/mappers and never cross into lib/core or components
 * (docs/architecture/api-and-data-access.md#mapper-discipline).
 *
 * Together with lib/validation, this file is each milestone's contract
 * (docs/architecture/source-structure.md).
 */

import type { SupportedCurrency } from './money/currency';
import type { Minor } from './money/parse';

/**
 * Spec §5's account kinds. GCash and Maya are both `ewallet`: the provider is
 * a display concern, not a type. Must match the database enum `account_type`
 * exactly — lib/validation/accounts.ts fails to compile if they differ.
 */
export const ACCOUNT_TYPES = [
  'cash',
  'bank',
  'ewallet',
  'credit_card',
  'savings',
  'other',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: SupportedCurrency;
  /** The balance when the account was added. Negative for a card in debt. */
  readonly openingBalanceMinor: Minor;
  /**
   * The current balance: the opening balance plus the signed transaction
   * ledger. Derived, never stored (docs/adr/0007-derived-account-balances.md).
   */
  readonly balanceMinor: Minor;
  /** Kept out of Safe to Spend — money set aside is not spendable. */
  readonly excludeFromSafeToSpend: boolean;
  /** When the account was archived (an ISO instant), or null while active. */
  readonly archivedAt: string | null;
  /** When the account was added (an ISO instant). */
  readonly createdAt: string;
}
