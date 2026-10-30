'use client';

import { useActionState } from 'react';

import { passwordUpdateSchema } from '@/lib/validation/auth';

import {
  ErrorSummary,
  SubmitButton,
  TextField,
  type FormAction,
  type FormState,
} from './form-parts';
import { useFieldValidation } from './use-field-validation';

/** M1-F03, step 2: choose the new password, from the recovery link's session. */
export function NewPasswordForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const { onBlur, onSubmit, errorsFor } = useFieldValidation(
    passwordUpdateSchema,
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
      <ErrorSummary message={state.message} />
      <TextField
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        description="8 to 72 characters, with at least one letter and one number."
        errors={errorsFor('password')}
      />
      <TextField
        name="confirmPassword"
        label="Type it again"
        type="password"
        autoComplete="new-password"
        required
        errors={errorsFor('confirmPassword')}
      />
      <SubmitButton
        pending={pending}
        label="Save my new password"
        pendingLabel="Saving…"
      />
    </form>
  );
}
