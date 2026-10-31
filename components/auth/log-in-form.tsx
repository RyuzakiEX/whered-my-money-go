'use client';

import { useActionState } from 'react';

import { signInSchema } from '@/lib/validation/auth';

import {
  ErrorSummary,
  SubmitButton,
  TextField,
  useFieldValues,
  useResultKey,
  type FormAction,
  type FormState,
} from './form-parts';
import { useFieldValidation } from './use-field-validation';

/**
 * M1-F02. A failed login shows only the action's uniform message — nothing
 * here distinguishes an unknown email from a wrong password.
 */
export function LogInForm({
  action,
  next,
}: {
  action: FormAction;
  /** Where the user was headed; the action re-checks it is same-origin. */
  next: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const bind = useFieldValues(['email', 'password']);
  const resultKey = useResultKey(state);
  const { onBlur, onSubmit, errorsFor } = useFieldValidation(
    signInSchema,
    state.fields,
  );

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      onBlur={onBlur}
      noValidate
      className="flex flex-col gap-5"
    >
      <ErrorSummary key={resultKey} message={state.message} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField
        name="email"
        {...bind('email')}
        label="Email"
        type="email"
        autoComplete="username"
        required
        errors={errorsFor('email')}
      />
      <TextField
        name="password"
        {...bind('password')}
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        errors={errorsFor('password')}
      />
      <SubmitButton
        pending={pending}
        label="Log in"
        pendingLabel="Logging you in…"
      />
    </form>
  );
}
