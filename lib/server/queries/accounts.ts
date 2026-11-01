// Account reads (M2-B05).
//
// MAY BE IMPORTED BY: app/ Server Components, lib/server/actions/**.
//
// The user comes from the verified session, never from an argument, and RLS
// scopes every read to that same user. Another user's account is therefore
// indistinguishable from a missing one. Throws on an infrastructure failure —
// reads do not return an envelope (docs/architecture/api-and-data-access.md).
//
// Balances: derived, never stored (docs/adr/0007-derived-account-balances.md).
// Until the account_balances view lands with transactions in M3 (M2-B02), an
// account's balance is its opening balance — correct, because no transaction
// can exist yet. The view will replace `balanceOf` below and nothing else.

import { z } from 'zod';

import type { Minor } from '@/lib/core/money/parse';
import type { Account } from '@/lib/core/types';
import { sessionUserId } from '@/lib/server/auth/session';
import {
  ACCOUNT_COLUMNS,
  toDomainAccount,
  type AccountRow,
} from '@/lib/server/mappers/accounts';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';

/** M2-B02 (in M3) swaps this for the account_balances view. */
function balanceOf(row: Pick<AccountRow, 'opening_balance_minor'>): Minor {
  return row.opening_balance_minor;
}

/** A malformed id names no account; asking Postgres would raise 22P02. */
const isUuid = (id: string) => z.uuid().safeParse(id).success;

export interface ListAccountsOptions {
  /** Archived accounts are hidden unless asked for. */
  readonly includeArchived?: boolean;
}

/**
 * The user's accounts, ordered by type (in the enum's declared order) and then
 * by name. One query, however many accounts.
 */
export async function listAccounts(
  options: ListAccountsOptions = {},
): Promise<Account[]> {
  const supabase = await createServerSupabaseClient();
  const userId = await sessionUserId(supabase);
  if (!userId) return [];

  let query = supabase
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId);
  if (!options.includeArchived) query = query.is('archived_at', null);

  const { data, error } = await query
    .order('type', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(`accounts read failed: ${error.code}`);

  return data.map((row) => toDomainAccount(row, balanceOf(row)));
}

/**
 * One account, archived or not, or null — when it does not exist, belongs to
 * another user, or the id is malformed. The caller cannot tell which, by
 * design: "not yours" must read as "not there".
 */
export async function getAccount(id: string): Promise<Account | null> {
  if (!isUuid(id)) return null;
  const supabase = await createServerSupabaseClient();
  const userId = await sessionUserId(supabase);
  if (!userId) return null;

  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`account read failed: ${error.code}`);

  return data ? toDomainAccount(data, balanceOf(data)) : null;
}

/**
 * Balances for a set of accounts, in one query. Ids that are malformed, missing,
 * or another user's are simply absent from the result. Archived accounts are
 * NOT filtered out: this answers for the ids it is given, and an archived
 * account's own page still shows its balance. A total, a picker, or a Safe to
 * Spend input must start from listAccounts(), which hides archived accounts.
 */
export async function getAccountBalances(
  ids: readonly string[],
): Promise<Map<string, Minor>> {
  const wanted = [...new Set(ids)].filter(isUuid);
  if (wanted.length === 0) return new Map();
  const supabase = await createServerSupabaseClient();
  const userId = await sessionUserId(supabase);
  if (!userId) return new Map();

  const { data, error } = await supabase
    .from('accounts')
    .select('id, opening_balance_minor')
    .eq('user_id', userId)
    .in('id', wanted);
  if (error) throw new Error(`account balances read failed: ${error.code}`);

  return new Map(data.map((row) => [row.id, balanceOf(row)]));
}
