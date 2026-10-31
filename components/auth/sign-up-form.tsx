'use client';

import { useActionState } from 'react';

import { signUpSchema } from '@/lib/validation/auth';

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

/** M1-F01. The page passes the Server Action in; this renders and validates. */
export function SignUpForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const bind = useFieldValues(['email', 'password', 'displayName']);
  const resultKey = useResultKey(state);
  const { onBlur, onSubmit, errorsFor } = useFieldValidation(
    signUpSchema,
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
      <TextField
        name="email"
        {...bind('email')}
        label="Email"
        type="email"
        autoComplete="email"
        required
        errors={errorsFor('email')}
      />
      <TextField
        name="password"
        {...bind('password')}
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        description="8 to 72 characters, with at least one letter and one number."
        errors={errorsFor('password')}
      />
      <TextField
        name="displayName"
        {...bind('displayName')}
        label="What should we call you? (optional)"
        autoComplete="nickname"
        errors={errorsFor('displayName')}
      />
      <SubmitButton
        pending={pending}
        label="Create my account"
        pendingLabel="Creating your account…"
      />
    </form>
  );
}
