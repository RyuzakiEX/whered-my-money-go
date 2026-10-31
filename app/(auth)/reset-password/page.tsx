import type { Metadata } from 'next';
import Link from 'next/link';

import type { FormState } from '@/components/auth/form-parts';
import { ResetRequestForm } from '@/components/auth/reset-request-form';
import { requestPasswordReset } from '@/lib/server/actions/auth';
import { pickFields } from '@/lib/utils/form-data';

import { toFormState } from '../form-state';

export const metadata: Metadata = { title: 'Reset your password' };

async function requestResetFromForm(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  'use server';
  return toFormState(
    await requestPasswordReset(pickFields(formData, ['email'])),
  );
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { link } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="text-muted-foreground">
          It happens to the best of us. Tell us your email and we&apos;ll send a
          link.
        </p>
      </div>
      {link === 'expired' ? (
        <p
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-3 text-sm"
        >
          That reset link has expired or was already used. Links work once, for
          a limited time. Ask for a fresh one below.
        </p>
      ) : null}
      <ResetRequestForm action={requestResetFromForm} />
      <Link
        href="/login"
        className="text-sm font-medium underline underline-offset-4"
      >
        Back to log in
      </Link>
    </main>
  );
}
