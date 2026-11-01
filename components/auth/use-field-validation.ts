'use client';

import { useState, type FocusEvent, type SubmitEvent } from 'react';
import type { z } from 'zod';

/**
 * Inline validation with the SAME schema the Server Action parses with
 * (lib/validation), so the form and the action cannot disagree.
 *
 * - On blur: re-check that one field and show or clear its error.
 * - On submit: check everything; if anything is wrong, stop the submission
 *   and move focus to the first invalid field.
 *
 * A field the user has touched shows the client's verdict; an untouched one
 * shows whatever the server last returned.
 */
export function useFieldValidation(
  schema: z.ZodType,
  serverErrors: Record<string, string[]> | undefined,
) {
  const [clientErrors, setClientErrors] = useState<Record<string, string[]>>(
    {},
  );

  function errorsByField(form: HTMLFormElement): Record<string, string[]> {
    const values: Record<string, string> = {};
    for (const element of Array.from(form.elements)) {
      if (
        element instanceof HTMLInputElement &&
        element.name &&
        element.type !== 'hidden'
      ) {
        values[element.name] = element.value;
      }
    }
    const result = schema.safeParse(values);
    const errors: Record<string, string[]> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? '_');
        (errors[key] ??= []).push(issue.message);
      }
    }
    return errors;
  }

  function onBlur(event: FocusEvent<HTMLFormElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.name || !target.form) {
      return;
    }
    // Do not shout at a field the user tabbed past without typing.
    if (target.value === '' && !(target.name in clientErrors)) return;
    const errors = errorsByField(target.form);
    setClientErrors((previous) => ({
      ...previous,
      [target.name]: errors[target.name] ?? [],
    }));
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const errors = errorsByField(form);
    const names = Array.from(form.elements)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
      .map((el) => el.name);
    const firstInvalid = names.find((name) => (errors[name]?.length ?? 0) > 0);

    if (firstInvalid) {
      const next: Record<string, string[]> = {};
      for (const name of names) if (name) next[name] = errors[name] ?? [];
      setClientErrors(next);
      event.preventDefault();
      form.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    // Valid: hand over to the server. Clear the client's verdicts so the
    // server's field errors (if any) are what the form shows next.
    setClientErrors({});
  }

  function errorsFor(name: string): string[] | undefined {
    return name in clientErrors ? clientErrors[name] : serverErrors?.[name];
  }

  return { onBlur, onSubmit, errorsFor };
}
