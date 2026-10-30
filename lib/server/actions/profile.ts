'use server';

// Profile Server Actions (M1-B07).
//
// MAY BE IMPORTED BY: the Settings > Profile form (M1-F05).
//
// The row to update comes from the SESSION, never from input: the strict
// schema rejects a submitted `id` or `user_id` outright, and the update names
// the session's id itself. RLS would refuse another user's row anyway — this
// is the application half of "never trust the client for ownership".

import { revalidateForProfileChange } from '@/lib/server/cache/revalidate';
import { logger, newRequestId } from '@/lib/server/logger';
import {
  fail,
  ok,
  validationError,
  type ActionResult,
} from '@/lib/server/result';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';
import {
  profileUpdateSchema,
  type ProfileUpdateInput,
} from '@/lib/validation/profile';

export async function updateProfile(
  input: unknown,
): Promise<ActionResult<ProfileUpdateInput>> {
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const requestId = newRequestId();

  const supabase = await createServerSupabaseClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (!userId) return fail({ kind: 'unauthenticated' });

  const { displayName, currency, timezone } = parsed.data;
  // Explicit column allowlist: never spread client input into a write.
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, currency, timezone })
    .eq('id', userId)
    .select('id');

  if (error || data.length !== 1) {
    // The schema mirrors the table's checks and RLS scopes the row to this
    // user, so reaching here is our bug, not the user's input.
    logger.error('profile.update_failed', {
      requestId,
      userId,
      action: 'updateProfile',
      outcome: 'failure',
      errorCode: error?.code ?? `rows_${String(data?.length ?? 0)}`,
    });
    return fail({ kind: 'unexpected', correlationId: requestId });
  }

  revalidateForProfileChange(userId);
  logger.info('profile.updated', {
    requestId,
    userId,
    action: 'updateProfile',
    outcome: 'success',
  });
  return ok(parsed.data);
}
