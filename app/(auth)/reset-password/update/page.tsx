import type { Metadata } from 'next';
import Link from 'next/link';

import type { FormState } from '@/components/auth/form-parts';
import { NewPasswordForm } from '@/components/auth/new-password-form';
import { signOut, updatePassword } from '@/lib/server/actions/auth';
import { isRecentRecovery } from '@/lib/server/auth/recovery';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';
import { pickFields } from '@/lib/utils/form-data';

import { toFormState } from '../../form-state';

export const metadata: Metadata = { title: 'Choose a new password' };

const LINK_EXPIRED =
  'This reset link has expired. Ask for a fresh one and try again.';

async function updatePasswordFromForm(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  'use server';
  const result = await updatePassword(
    pickFields(formData, ['password', 'confirmPassword']),
  );
  // updatePassword accepts only a recent recovery-link session; anything else
  // means the link's window has passed.
  if (!result.ok && result.error.kind === 'unauthenticated') {
    return { message: LINK_EXPIRED };
  }
  return toFormState(result);
}

/** "Not you?" — leave the session this link created. */
async function signOutFromForm(): Promise<void> {
  'use server';
  await signOut();
}

export default async function UpdatePasswordPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  // The same check updatePassword applies: an ordinary session, or a recovery
  // older than an hour, would only get a form that always fails (code review
  // of #55).
  const fromRecoveryLink = isRecentRecovery(data?.claims.amr);
  // The account this link actually signed into, from the verified session —
  // never from the link, which an attacker controls (security review of #55).
  const account =
    typeof data?.claims.email === 'string' ? data.claims.email : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
        <p className="text-muted-foreground">
          Make it a good one. Future-you will thank you.
        </p>
      </div>
      {fromRecoveryLink ? (
        <div className="flex flex-col gap-4">
          {/* Shown before anything changes: if someone sent you their own
              reset link, this is where you notice it is not your account. */}
          {account ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-3 py-3 text-sm">
              <p>
                Choosing a new password for <strong>{account}</strong>.
              </p>
              <form action={signOutFromForm}>
                <button
                  type="submit"
                  className="font-medium underline underline-offset-4"
                >
                  Not your account? Sign out
                </button>
              </form>
            </div>
          ) : null}
          <NewPasswordForm action={updatePasswordFromForm} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p
            role="status"
            className="rounded-md border border-border bg-muted px-3 py-3 text-sm"
          >
            This page opens from the link in your reset email, and that link
            seems to have expired or was already used.
          </p>
          <Link
            href="/reset-password"
            className="text-sm font-medium underline underline-offset-4"
          >
            Ask for a fresh reset link
          </Link>
        </div>
      )}
    </main>
  );
}
