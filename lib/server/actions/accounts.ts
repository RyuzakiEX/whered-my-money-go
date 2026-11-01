'use server';

// Account Server Actions (M2-B06).
//
// MAY BE IMPORTED BY: the account forms and menus (M2-F02, M2-F03, M2-F04).
//
// Each action follows the documented order: the user from the SESSION, then
// the input, then an ownership re-check, then the write
// (docs/architecture/api-and-data-access.md#server-actions). The re-check runs
// even though RLS also enforces ownership: RLS answers "may this user touch
// this row", not "what should they be told". Another user's account answers
// `not_found`, exactly like an id that never existed, so ids cannot be probed.
// Every write is also scoped by user_id, so a missing policy is never the
// only thing between one user and another's account.
//
// Writes name every column. Client input is never spread into a row.

import type { SupportedCurrency } from '@/lib/core/money/currency';
import { isSupportedCurrency } from '@/lib/core/money/currency';
import { SessionError, sessionUserId } from '@/lib/server/auth/session';
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

/** A step either produces its value or the envelope to return instead. */
type Step<T> = { value: T } | { failure: ActionResult<never> };

const NOT_FOUND = fail({ kind: 'not_found', entity: 'account' });

/** The request-scoped context every action starts from. */
interface Context {
  supabase: ServerClient;
  requestId: string;
  action: AccountAction;
}

/**
 * Logs an infrastructure failure and answers with a correlation id only.
 * Never the driver's message, and never an amount or name beside the user
 * id (docs/architecture/observability.md).
 */
function unexpected(
  { requestId, action }: Context,
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

/** Step 1: the session's user. */
async function start(
  action: AccountAction,
): Promise<Step<Context & { userId: string }>> {
  const ctx: Context = {
    supabase: await createServerSupabaseClient(),
    requestId: newRequestId(),
    action,
  };
  let userId: string | null;
  try {
    userId = await sessionUserId(ctx.supabase);
  } catch (error) {
    // Auth itself failed. Not "signed out": that would send the user to log
    // in again for nothing. Anything else is our bug, and should surface.
    if (!(error instanceof SessionError)) throw error;
    return { failure: unexpected(ctx, 'account.auth_failed', error.code) };
  }
  if (!userId) return { failure: fail({ kind: 'unauthenticated' }) };
  return { value: { ...ctx, userId } };
}

/**
 * The ownership re-check: the account as this user can see it. A missing
 * account and another user's answer the same `not_found`.
 */
async function ownedAccount(
  ctx: Context & { userId: string },
  id: string,
): Promise<Step<{ currency: string; archived_at: string | null }>> {
  const { data, error } = await ctx.supabase
    .from('accounts')
    .select('currency, archived_at')
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) {
    return {
      failure: unexpected(ctx, 'account.read_failed', error.code, ctx.userId),
    };
  }
  return data ? { value: data } : { failure: NOT_FOUND };
}

/**
 * The field error for a name that collides, ignoring case, with another of
 * the user's accounts — naming the existing account as the user wrote it.
 * Compared here rather than with ILIKE, where `%`, `_`, and (in PostgREST)
 * `*` are wildcards that could name the wrong account.
 */
async function nameTaken(
  ctx: Context & { userId: string },
  name: string,
): Promise<ActionResult<never>> {
  const { data } = await ctx.supabase
    .from('accounts')
    .select('name')
    .eq('user_id', ctx.userId);
  const wanted = name.toLowerCase();
  const existing = data?.find((row) => row.name.toLowerCase() === wanted);
  return fail({
    kind: 'validation',
    fields: { name: [ACCOUNT_MESSAGES.nameTaken(existing?.name ?? name)] },
  });
}

const isUniqueName = (error: { code: string; message: string }) =>
  error.code === '23505' && error.message.includes('accounts_unique_name');

export async function createAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  const started = await start('createAccount');
  if ('failure' in started) return started.failure;
  const ctx = started.value;
  const { supabase, userId } = ctx;

  // The account's currency is the profile's, chosen here and never taken
  // from the client — so the balance is parsed in that currency too.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('currency')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile || !isSupportedCurrency(profile.currency)) {
    return unexpected(
      ctx,
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
    if (isUniqueName(error)) return nameTaken(ctx, name);
    return unexpected(ctx, 'account.write_failed', error.code, userId);
  }

  revalidateForAccountChange(userId);
  logger.info('account.created', {
    requestId: ctx.requestId,
    userId,
    action: ctx.action,
    outcome: 'success',
  });
  return ok({ id: data.id });
}

export async function updateAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  const started = await start('updateAccount');
  if ('failure' in started) return started.failure;
  const ctx = started.value;
  const { supabase, userId } = ctx;

  // The id first: the rest is parsed in the account's own currency, which may
  // differ from the profile's if that changed after the account was added.
  const target = accountIdSchema.safeParse({
    id: (input as { id?: unknown } | null)?.id,
  });
  if (!target.success) return validationError(target.error);

  const owned = await ownedAccount(ctx, target.data.id);
  if ('failure' in owned) return owned.failure;
  const account = owned.value;
  if (!isSupportedCurrency(account.currency)) return NOT_FOUND;
  // Archived accounts are read-only until restored; the detail page disables
  // editing (M2-F04), and this holds when a stale tab does not.
  if (account.archived_at !== null) {
    return fail({
      kind: 'conflict',
      reason: 'account_archived',
      message: ACCOUNT_MESSAGES.archived,
    });
  }

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
    // Archived between the re-check and here: refuse, as above.
    .is('archived_at', null)
    .select('id');
  if (error) {
    if (isUniqueName(error)) return nameTaken(ctx, name);
    return unexpected(ctx, 'account.write_failed', error.code, userId);
  }
  // Deleted or archived between the re-check and the write.
  if (data.length !== 1) return NOT_FOUND;

  revalidateForAccountChange(userId);
  logger.info('account.updated', {
    requestId: ctx.requestId,
    userId,
    action: ctx.action,
    outcome: 'success',
  });
  return ok({ id });
}

/**
 * Sets or clears archived_at. Idempotent both ways, and safe against a
 * concurrent request: the write applies only while the account is still in
 * the other state, so a double-click never moves the original archive time.
 */
async function setArchived(
  input: unknown,
  archived: boolean,
): Promise<ActionResult<AccountRef>> {
  const started = await start(archived ? 'archiveAccount' : 'restoreAccount');
  if ('failure' in started) return started.failure;
  const ctx = started.value;
  const { supabase, userId } = ctx;

  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id } = parsed.data;

  const owned = await ownedAccount(ctx, id);
  if ('failure' in owned) return owned.failure;
  if ((owned.value.archived_at !== null) === archived) return ok({ id });

  let write = supabase
    .from('accounts')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('user_id', userId);
  write = archived
    ? write.is('archived_at', null)
    : write.not('archived_at', 'is', null);
  const { data, error } = await write.select('id');
  if (error) {
    return unexpected(ctx, 'account.write_failed', error.code, userId);
  }
  if (data.length !== 1) {
    // Lost a race: another request archived (or restored) it first, which
    // is this request's outcome too — or the account was deleted meanwhile.
    const again = await ownedAccount(ctx, id);
    return 'failure' in again ? again.failure : ok({ id });
  }

  revalidateForAccountRemoval(userId);
  logger.info(archived ? 'account.archived' : 'account.restored', {
    requestId: ctx.requestId,
    userId,
    action: ctx.action,
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
 * Deletes the account. The ownership re-check IS the write's user_id scope
 * and its row count: a separate read first would add a round trip and answer
 * the same question. In M2 no account can have a transaction; M3-B03 adds
 * the `blocked` result for one that does, with the `on delete restrict`
 * foreign key as the database backstop.
 */
export async function deleteAccount(
  input: unknown,
): Promise<ActionResult<AccountRef>> {
  const started = await start('deleteAccount');
  if ('failure' in started) return started.failure;
  const ctx = started.value;
  const { supabase, userId } = ctx;

  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id } = parsed.data;

  const { data, error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) {
    return unexpected(ctx, 'account.write_failed', error.code, userId);
  }
  if (data.length !== 1) return NOT_FOUND;

  revalidateForAccountRemoval(userId);
  logger.info('account.deleted', {
    requestId: ctx.requestId,
    userId,
    action: ctx.action,
    outcome: 'success',
  });
  return ok({ id });
}
