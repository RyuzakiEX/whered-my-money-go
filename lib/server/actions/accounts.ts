'use server';

// Account Server Actions (M2-B06).
//
// MAY BE IMPORTED BY: the account forms and menus (M2-F02, M2-F03, M2-F04).
//
// Every action takes the user from the SESSION and re-verifies that the
// account is theirs before writing, even though RLS also enforces it: RLS
// answers "may this user touch this row", not "what should they be told".
// Another user's account answers `not_found`, exactly like an id that never
// existed, so ids cannot be probed
// (docs/architecture/api-and-data-access.md#ownership-re-checks).
//
// Writes name every column. Client input is never spread into a row.

import type { SupportedCurrency } from '@/lib/core/money/currency';
import { isSupportedCurrency } from '@/lib/core/money/currency';
import { sessionUserId } from '@/lib/server/auth/session';
import {
  revalidateForAccountChange,
  revalidateForAccountRemoval,
} from '@/lib/server/cache/revalidate';
import { logger, newRequestId } from '@/lib/server/logger';
import {
  fail,
  ok,
  validationError,
  type ActionResult,
} from '@/lib/server/result';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';
import {
  ACCOUNT_MESSAGES,
  accountCreateSchema,
  accountIdSchema,
  accountUpdateSchema,
} from '@/lib/validation/accounts';

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type AccountAction =
  | 'createAccount'
  | 'updateAccount'
  | 'archiveAccount'
  | 'restoreAccount'
  | 'deleteAccount';

/** What every account action returns: the account it acted on. */
export interface AccountRef {
  id: string;
}

const NOT_FOUND = fail({ kind: 'not_found', entity: 'account' });

/**
 * Logs an infrastructure failure and answers with a correlation id only.
 * Never the driver's message, and never an amount or name beside the user
 * id (docs/architecture/observability.md).
 */
function unexpected(
  requestId: string,
  action: AccountAction,
  event: string,
  errorCode: string,
  userId?: string,
): ActionResult<never> {
  logger.error(event, {
    requestId,
    ...(userId ? { userId } : {}),
    action,
    outcome: 'failure',
    errorCode,
  });
  return fail({ kind: 'unexpected', correlationId: requestId });
}

/** The session's user, or the envelope to return instead. */
async function requireUser(
  supabase: ServerClient,
  requestId: string,
  action: AccountAction,
): Promise<{ userId: string } | { failure: ActionResult<never> }> {
  let userId: string | null;
  try {
    userId = await sessionUserId(supabase);
  } catch {
    // Auth itself failed. Not "signed out": that would send the user to log
    // in again for nothing.
    return {
      failure: unexpected(requestId, action, 'account.auth_failed', 'auth'),
    };
  }
  return userId ? { userId } : { failure: fail({ kind: 'unauthenticated' }) };
}

/**
 * The ownership re-check: the account as this user can see it, or null.
 * Scoped by user_id as well as by RLS, so a missed policy is not the only
 * thing between a user and another's account.
 */
async function ownedAccount(
  supabase: ServerClient,
  userId: string,
  id: string,
) {
  return supabase
    .from('accounts')
    .select('id, currency, archived_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
}

/** `\`, `%`, and `_` are wildcards in ILIKE; an account name is literal. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The field error for a name that collides, case-insensitively, with another
 * of the user's accounts. Names the existing account as the user wrote it.
 */
async function nameTaken(
  supabase: ServerClient,
  userId: string,
  name: string,
): Promise<ActionResult<never>> {
  const { data } = await supabase
    .from('accounts')
    .select('name')
    .eq('user_id', userId)
    .ilike('name', likeLiteral(name))
    .limit(1)
    .maybeSingle();
  return fail({
    kind: 'validation',
    fields: { name: [ACCOUNT_MESSAGES.nameTaken(data?.name ?? name)] },
  });
}

const isUniqueName = (error: { code: string; message: string }) =>
  error.code === '23505' && error.message.includes('accounts_unique_name');

export async function createAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  const requestId = newRequestId();
  const action = 'createAccount';
  const supabase = await createServerSupabaseClient();
  const session = await requireUser(supabase, requestId, action);
  if ('failure' in session) return session.failure;
  const { userId } = session;

  // The account's currency is the profile's, chosen here and never taken
  // from the client — so the balance is parsed in that currency too.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('currency')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile || !isSupportedCurrency(profile.currency)) {
    return unexpected(
      requestId,
      action,
      'account.profile_unreadable',
      profileError?.code ?? 'no_profile',
      userId,
    );
  }
  const currency: SupportedCurrency = profile.currency;

  const parsed = accountCreateSchema(currency).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { name, type, openingBalanceMinor, excludeFromSafeToSpend } =
    parsed.data;

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      user_id: userId,
      name,
      type,
      currency,
      opening_balance_minor: openingBalanceMinor,
      exclude_from_safe_to_spend: excludeFromSafeToSpend,
    })
    .select('id')
    .single();
  if (error) {
    if (isUniqueName(error)) return nameTaken(supabase, userId, name);
    return unexpected(
      requestId,
      action,
      'account.write_failed',
      error.code,
      userId,
    );
  }

  revalidateForAccountChange(userId);
  logger.info('account.created', {
    requestId,
    userId,
    action,
    outcome: 'success',
  });
  return ok({ id: data.id });
}

export async function updateAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  const requestId = newRequestId();
  const action = 'updateAccount';

  // The id first: the rest is parsed in the account's own currency, which may
  // differ from the profile's if that changed after the account was added.
  const target = accountIdSchema.safeParse({
    id: (input as { id?: unknown } | null)?.id,
  });
  if (!target.success) return validationError(target.error);

  const supabase = await createServerSupabaseClient();
  const session = await requireUser(supabase, requestId, action);
  if ('failure' in session) return session.failure;
  const { userId } = session;

  const { data: account, error: readError } = await ownedAccount(
    supabase,
    userId,
    target.data.id,
  );
  if (readError) {
    return unexpected(
      requestId,
      action,
      'account.read_failed',
      readError.code,
      userId,
    );
  }
  if (!account || !isSupportedCurrency(account.currency)) return NOT_FOUND;

  const parsed = accountUpdateSchema(account.currency).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, name, type, openingBalanceMinor, excludeFromSafeToSpend } =
    parsed.data;

  const { data, error } = await supabase
    .from('accounts')
    .update({
      name,
      type,
      opening_balance_minor: openingBalanceMinor,
      exclude_from_safe_to_spend: excludeFromSafeToSpend,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) {
    if (isUniqueName(error)) return nameTaken(supabase, userId, name);
    return unexpected(
      requestId,
      action,
      'account.write_failed',
      error.code,
      userId,
    );
  }
  // Deleted between the re-check and the write.
  if (data.length !== 1) return NOT_FOUND;

  revalidateForAccountChange(userId);
  logger.info('account.updated', {
    requestId,
    userId,
    action,
    outcome: 'success',
  });
  return ok({ id });
}

/**
 * Sets or clears archived_at. Idempotent both ways: archiving an archived
 * account keeps its original archive time.
 */
async function setArchived(
  input: unknown,
  archived: boolean,
): Promise<ActionResult<AccountRef>> {
  const requestId = newRequestId();
  const action = archived ? 'archiveAccount' : 'restoreAccount';
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id } = parsed.data;

  const supabase = await createServerSupabaseClient();
  const session = await requireUser(supabase, requestId, action);
  if ('failure' in session) return session.failure;
  const { userId } = session;

  const { data: account, error: readError } = await ownedAccount(
    supabase,
    userId,
    id,
  );
  if (readError) {
    return unexpected(
      requestId,
      action,
      'account.read_failed',
      readError.code,
      userId,
    );
  }
  if (!account) return NOT_FOUND;
  if ((account.archived_at !== null) === archived) return ok({ id });

  const { data, error } = await supabase
    .from('accounts')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) {
    return unexpected(
      requestId,
      action,
      'account.write_failed',
      error.code,
      userId,
    );
  }
  if (data.length !== 1) return NOT_FOUND;

  revalidateForAccountRemoval(userId);
  logger.info(archived ? 'account.archived' : 'account.restored', {
    requestId,
    userId,
    action,
    outcome: 'success',
  });
  return ok({ id });
}

/** Hides the account from lists, pickers, totals, and Safe to Spend. */
export async function archiveAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  return setArchived(input, true);
}

/** Undoes an archive (M2-F01's restore, M2-F03's Undo). */
export async function restoreAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  return setArchived(input, false);
}

/**
 * Deletes the account. In M2 no account can have a transaction; M3-B03 adds
 * the `blocked` result for one that does, with the `on delete restrict`
 * foreign key as the database backstop.
 */
export async function deleteAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  const requestId = newRequestId();
  const action = 'deleteAccount';
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id } = parsed.data;

  const supabase = await createServerSupabaseClient();
  const session = await requireUser(supabase, requestId, action);
  if ('failure' in session) return session.failure;
  const { userId } = session;

  const { data: account, error: readError } = await ownedAccount(
    supabase,
    userId,
    id,
  );
  if (readError) {
    return unexpected(
      requestId,
      action,
      'account.read_failed',
      readError.code,
      userId,
    );
  }
  if (!account) return NOT_FOUND;

  const { data, error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) {
    return unexpected(
      requestId,
      action,
      'account.write_failed',
      error.code,
      userId,
    );
  }
  if (data.length !== 1) return NOT_FOUND;

  revalidateForAccountRemoval(userId);
  logger.info('account.deleted', {
    requestId,
    userId,
    action,
    outcome: 'success',
  });
  return ok({ id });
}
