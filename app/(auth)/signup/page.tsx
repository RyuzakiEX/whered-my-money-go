import type { Metadata } from 'next';
import Link from 'next/link';

import type { FormState } from '@/components/auth/form-parts';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { signUp } from '@/lib/server/actions/auth';
import { pickFields } from '@/lib/utils/form-data';

import { toFormState } from '../form-state';

export const metadata: Metadata = { title: 'Sign up' };

/** The form's action. Picks only this form's fields; signUp redirects on success. */
async function signUpFromForm(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  'use server';
  return toFormState(
    await signUp(pickFields(formData, ['email', 'password', 'displayName'])),
  );
}

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="text-muted-foreground">
          Let&apos;s find out where your money actually goes. No judgment.
        </p>
      </div>
      <SignUpForm action={signUpFromForm} />
      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </main>
  );
}
