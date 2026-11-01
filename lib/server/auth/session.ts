// The signed-in user's id, from the verified session.
//
// MAY BE IMPORTED BY: lib/server/** (queries and actions).
//
// The one way a query learns whose data to read: never from an argument, so
// no caller can ask for another user's rows (rls-policies.md is the backstop).

import type { createServerSupabaseClient } from '@/lib/server/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Auth itself failed. Carries Auth's error code, for the logs. */
export class SessionError extends Error {
  constructor(readonly code: string) {
    super(`session check failed: ${code}`);
    this.name = 'SessionError';
  }
}

/**
 * The session's user id, or null when signed out. Throws when Auth itself
 * fails: that is an outage, not a signed-out user, and must not render as an
 * empty list.
 */
export async function sessionUserId(
  supabase: ServerClient,
): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error) throw new SessionError(error.code ?? 'unknown');
  return data?.claims.sub ?? null;
}
