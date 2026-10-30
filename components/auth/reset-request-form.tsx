'use client';

import { useActionState } from 'react';

import { passwordResetRequestSchema } from '@/lib/validation/auth';

import {
  ErrorSummary,
  SubmitButton,
  TextField,
  type FormAction,
  type FormState,
} from './form-parts';
import { useFieldValidation } from './use-field-validation';

/**
 * The one message every reset request gets, whether or not the email has an
 * account — so this page cannot be used to find out who has one.
 */
export const RESET_REQUESTED =
  "If there's an account for that email, a reset link is on its way. Check your inbox (and the spam folder, just in case).";

/** M1-F03, step 1: ask for the email. */
export function ResetRequestForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const { onBlur, onSubmit, errorsFor } = useFieldValidation(
    passwordResetRequestSchema,
    state.fields,
  );

  if (state.done) {
    return (
      <p
        role="status"
        className="rounded-md border border-border bg-muted px-3 py-3 text-sm"
      >
        {RESET_REQUESTED}
      </p>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      onBlur={onBlur}
      noValidate
      className="flex flex-col gap-5"
    >
      <ErrorSummary message={state.message} />
      <TextField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        errors={errorsFor('email')}
      />
      <SubmitButton
        pending={pending}
        label="Send me a reset link"
        pendingLabel="Sending…"
      />
    </form>
  );
}
