// Is this session fresh from a password-recovery link? (M1-B05, M1-F03)
//
// MAY BE IMPORTED BY: lib/server/** and app/ Server Components. Shared by
// updatePassword and the page that shows its form, so the page never offers
// a form the action will refuse (code review of #55).

/** How recent a recovery-link sign-in must be to change the password. */
const RECOVERY_WINDOW_SECONDS = 3600;

/**
 * Methods a password-recovery link signs in with, observed against the local
 * stack. The emailed link carries a token hash that /auth/confirm verifies
 * (verifyOtp), which yields `otp`; Supabase's default email (a PKCE code
 * that /auth/confirm exchanges) yields `recovery`. A password login yields
 * `password`, which is refused. The MVP has no other OTP sign-in, so `otp`
 * also means "came from the link".
 */
const RECOVERY_METHODS: ReadonlySet<string> = new Set(['recovery', 'otp']);

type AmrEntry = string | { method: string; timestamp: number };

/** True when the session came from a password-recovery link in the last hour. */
export function isRecentRecovery(
  amr: readonly AmrEntry[] | undefined,
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
