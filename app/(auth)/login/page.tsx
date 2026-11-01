import type { Metadata } from 'next';
import Link from 'next/link';

import type { FormState } from '@/components/auth/form-parts';
import { LogInForm } from '@/components/auth/log-in-form';
import { signIn } from '@/lib/server/actions/auth';
import { pickFields } from '@/lib/utils/form-data';
import { safeNextPath } from '@/lib/utils/routes';

import { toFormState } from '../form-state';

export const metadata: Metadata = { title: 'Log in' };

/** The form's action. signIn re-checks `next` and redirects on success. */
async function signInFromForm(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  'use server';
  const next = formData.get('next');
  return toFormState(
    await signIn(
      pickFields(formData, ['email', 'password']),
      typeof next === 'string' ? next : null,
    ),
  );
}

export default async function LogInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  // Only a same-origin path is carried into the form at all.
  const safeNext = typeof next === 'string' ? safeNextPath(next) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Log in</h1>
        <p className="text-muted-foreground">
          Welcome back. Your money missed you. Probably.
        </p>
      </div>
      <LogInForm action={signInFromForm} next={safeNext} />
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <Link
          href="/reset-password"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Forgot your password?
        </Link>
        <p>
          New here?{' '}
          <Link
            href="/signup"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
