import type { Metadata } from 'next';
import Link from 'next/link';

import { confirmEmailLink } from '@/lib/server/actions/auth';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';
import { pickFields } from '@/lib/utils/form-data';

export const metadata: Metadata = { title: 'Continue' };

/** The Continue button's action. confirmEmailLink always redirects. */
async function confirmFromForm(formData: FormData): Promise<void> {
  'use server';
  await confirmEmailLink(
    pickFields(formData, ['tokenHash', 'type', 'code', 'next']),
  );
}

/**
 * Where an emailed auth link lands (M1-F03). Opening it verifies NOTHING:
 * the token is spent only when the user presses Continue, a same-origin
 * POST. See confirmEmailLink for why (login CSRF, link scanners).
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  const fields = {
    tokenHash: one('token_hash'),
    type: one('type'),
    code: one('code'),
    next: one('next'),
  };
  const usable = Boolean(fields.code ?? (fields.tokenHash && fields.type));

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const signedInAs =
    typeof data?.claims.email === 'string' ? data.claims.email : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="text-muted-foreground">
          {usable
            ? 'One more tap and you can choose a new password.'
            : "This link is missing something. Ask for a fresh one and we'll sort you out."}
        </p>
      </div>
      {usable ? (
        <form action={confirmFromForm} className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) =>
            value ? (
              <input key={name} type="hidden" name={name} value={value} />
            ) : null,
          )}
          {signedInAs ? (
            <p className="rounded-md border border-border bg-muted px-3 py-3 text-sm">
              You&apos;re signed in as {signedInAs}. Continuing switches to the
              account this reset link belongs to.
            </p>
          ) : null}
          <button
            type="submit"
            className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Continue to choose a new password
          </button>
        </form>
      ) : (
        <Link
          href="/reset-password"
          className="text-sm font-medium underline underline-offset-4"
        >
          Ask for a fresh reset link
        </Link>
      )}
    </main>
  );
}
