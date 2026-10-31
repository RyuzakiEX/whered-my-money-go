'use server';

// Auth Server Actions (M1-B05).
//
// MAY BE IMPORTED BY: app/(auth)/** forms and the shell's logout control.
//
// Rules every action here follows:
//   - Parse with the shared schema first (lib/validation/auth); nothing
//     unparsed reaches Supabase.
//   - Sign-in and reset failures are ONE envelope with ONE message, whatever
//     the cause, so these endpoints never reveal whether an account exists.
//   - Raw Supabase errors never reach the client. They are logged as a stable
//     code only — never the email, never the password
//     (docs/architecture/observability.md#never-log-this).
//   - redirect() is called outside any try/catch: it works by throwing.

import { redirect } from 'next/navigation';

import { logger, newRequestId } from '@/lib/server/logger';
import {
  fail,
  ok,
  validationError,
  type ActionResult,
} from '@/lib/server/result';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';
import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from '@/lib/utils/routes';
import {
  passwordResetRequestSchema,
  passwordUpdateSchema,
  signInSchema,
  signUpSchema,
} from '@/lib/validation/auth';

/** The only thing a failed sign-in ever says. */
const SIGN_IN_FAILED =
  "That email and password don't match an account. Check both and try again.";

/** Sign-up failures, whatever the cause. */
const SIGN_UP_FAILED =
  "We couldn't create that account. If you already have one, try logging in.";

/** Supabase Auth's per-IP limit on sign-ins and sign-ups is a 5-minute window. */
const AUTH_RATE_LIMIT_WINDOW_SECONDS = 300;

interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || error.code === 'over_request_rate_limit';
}

/** Log the failure by code only, and return the given uniform envelope. */
function authFailure(
  action: string,
  requestId: string,
  error: AuthErrorLike,
  message: string,
): ActionResult<never> {
  logger.warn('auth.failure', {
    requestId,
    action,
    outcome: 'failure',
    errorCode: error.code ?? `status_${String(error.status ?? 'unknown')}`,
  });
  if (isRateLimited(error)) {
    return fail({
      kind: 'rate_limited',
      retryAfterSeconds: AUTH_RATE_LIMIT_WINDOW_SECONDS,
    });
  }
  return fail({ kind: 'auth_failed', message });
}

/** Where email links (password reset) send the user back to. */
function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit;
  // Vercel previews: the deployment's own URL, which the preview project's
  // redirect allowlist covers. Auth refuses any origin not on that list.
  const vercel = process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : 'http://localhost:3000';
}

export async function signUp(input: unknown): Promise<ActionResult<never>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { email, password, displayName } = parsed.data;
  const requestId = newRequestId();

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Read by the on_auth_user_created trigger into profiles.display_name.
    options: displayName ? { data: { display_name: displayName } } : {},
  });
  if (error) return authFailure('signUp', requestId, error, SIGN_UP_FAILED);

  logger.info('auth.sign_up', {
    requestId,
    action: 'signUp',
    outcome: 'success',
    ...(data.user ? { userId: data.user.id } : {}),
  });
  redirect('/dashboard');
}

/**
 * `next` is where the user was going before /login (M1-F02). It passes the
 * same same-origin check as the proxy, so the login form cannot be turned
 * into an open redirect.
 */
export async function signIn(
  input: unknown,
  next?: string | null,
): Promise<ActionResult<never>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const requestId = newRequestId();

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  // invalid_credentials (wrong password OR unknown email) and
  // email_not_confirmed both land here, with the same message.
  if (error) return authFailure('signIn', requestId, error, SIGN_IN_FAILED);

  logger.info('auth.sign_in', {
    requestId,
    action: 'signIn',
    outcome: 'success',
    userId: data.user.id,
  });
  redirect(safeNextPath(next) ?? DEFAULT_SIGNED_IN_PATH);
}

export async function signOut(): Promise<ActionResult<never>> {
  const requestId = newRequestId();
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    // The local session is cleared regardless; log and carry on to /login.
    logger.warn('auth.sign_out_failed', {
      requestId,
      action: 'signOut',
      outcome: 'failure',
      errorCode: error.code ?? 'unknown',
    });
  }
  redirect('/login');
}

/**
 * Always `{ ok: true }` for a well-formed email — sent or not — so the
 * response cannot be used to test whether an account exists.
 */
export async function requestPasswordReset(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = passwordResetRequestSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const requestId = newRequestId();

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: `${siteUrl()}/auth/callback?next=/reset-password/update` },
  );
  if (error) {
    // A rate limit is per-IP, not per-account, so reporting it leaks nothing.
    // Every other failure still answers "sent".
    if (isRateLimited(error)) {
      return authFailure('requestPasswordReset', requestId, error, '');
    }
    logger.warn('auth.failure', {
      requestId,
      action: 'requestPasswordReset',
      outcome: 'failure',
      errorCode: error.code ?? 'unknown',
    });
  }
  return ok(null);
}

/** How recent a recovery-link sign-in must be to change the password. */
const RECOVERY_WINDOW_SECONDS = 3600;

/**
 * Methods a password-recovery link signs in with, observed against the local
 * stack. The emailed link (PKCE: verify, then /auth/callback exchanges the
 * code) yields `recovery`; verifying the link's token hash directly yields
 * `otp`. A password login yields `password`, which is refused. The MVP has no
 * other OTP sign-in, so `otp` also means "came from the link".
 *
 * `recovery` was missing at first: the integration test used the token-hash
 * path, and only M1-F03's E2E through the real email showed that genuine
 * resets were being refused.
 */
const RECOVERY_METHODS: ReadonlySet<string> = new Set(['recovery', 'otp']);

/** True when the session came from a password-recovery link in the last hour. */
function isRecentRecovery(
  amr: readonly (string | { method: string; timestamp: number })[] | undefined,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return (amr ?? []).some(
    (entry) =>
      // A bare string (RFC 8176 form) has no timestamp, so its age cannot be
      // checked: not accepted.
      typeof entry !== 'string' &&
      RECOVERY_METHODS.has(entry.method) &&
      now - entry.timestamp <= RECOVERY_WINDOW_SECONDS,
  );
}

/**
 * Sets a new password — ONLY from a recent recovery-link session. An ordinary
 * signed-in session is refused: a stolen cookie or an unattended laptop must
 * not be enough to take an account over. Auth also revokes the user's other
 * sessions when the password changes (verified by test), and with
 * `secure_password_change` it refuses a direct API change from a stale
 * session, so this check cannot be sidestepped through the public anon key.
 */
export async function updatePassword(
  input: unknown,
): Promise<ActionResult<never>> {
  const parsed = passwordUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const requestId = newRequestId();

  const supabase = await createServerSupabaseClient();
  // getClaims verifies the JWT; the session in the cookie is not trusted as-is.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims || !isRecentRecovery(claims.amr)) {
    return fail({ kind: 'unauthenticated' });
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return authFailure(
      'updatePassword',
      requestId,
      error,
      "We couldn't update your password. Try a different one.",
    );
  }

  logger.info('auth.password_updated', {
    requestId,
    action: 'updatePassword',
    outcome: 'success',
    userId: claims.sub,
  });
  redirect('/dashboard');
}
