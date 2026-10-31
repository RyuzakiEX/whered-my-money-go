'use client';

// Shared pieces of the auth forms (M1-F01..F03).
//
// Components may not import lib/server (source-structure.md), so the state a
// form receives from its Server Action is described here structurally; the
// page adapts the action's envelope into it (app/(auth)/form-state.ts).

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** What a form shows after a submission. */
export interface FormState {
  /** Field errors, keyed by input name. */
  fields?: Record<string, string[]>;
  /** One message for the whole form: a failed sign-in, a rate limit, … */
  message?: string;
  /** A submission that succeeded without leaving the page (reset requested). */
  done?: boolean;
}

export type FormAction = (
  state: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * Field values held in state. React 19 resets an uncontrolled `<form action>`
 * after every action — including one that returned an error — so a mistyped
 * password wiped the email too (code review of #54). Controlled inputs are
 * not reset, and still submit normally without JavaScript.
 */
export function useFieldValues<K extends string>(names: readonly K[]) {
  const [values, setValues] = useState<Record<K, string>>(
    () =>
      Object.fromEntries(names.map((name) => [name, ''])) as Record<K, string>,
  );
  function bind(name: K) {
    return {
      value: values[name],
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        setValues((previous) => ({ ...previous, [name]: event.target.value }));
      },
    };
  }
  return bind;
}

/**
 * Counts completed submissions. Used as the summary's `key`, so every result
 * — even a second identical failure — mounts a fresh alert that is announced
 * and focused again (code review of #54).
 */
export function useResultKey(state: object): number {
  // React's "adjust state when an input changes" pattern: compared during
  // render, so the new key applies before commit — one mount per result, not
  // a render with the old key followed by a remount.
  const [seen, setSeen] = useState(state);
  const [count, setCount] = useState(0);
  if (seen !== state) {
    setSeen(state);
    setCount(count + 1);
  }
  return count;
}

/**
 * A form-level message that takes focus when it appears, so a screen reader
 * announces it and a keyboard user starts from it.
 */
export function ErrorSummary({ message }: { message: string | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {message}
    </div>
  );
}

interface TextFieldProps extends Omit<
  ComponentProps<typeof Input>,
  'id' | 'name'
> {
  name: string;
  label: string;
  description?: string;
  errors?: readonly string[] | undefined;
}

/** A labelled input whose description and error are tied to it for assistive tech. */
export function TextField({
  name,
  label,
  description,
  errors,
  className,
  ...input
}: TextFieldProps) {
  const descriptionId = description ? `${name}-description` : undefined;
  const errorId = errors?.length ? `${name}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <Field data-invalid={errorId ? true : undefined}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={describedBy}
        // 44px: the accessibility baseline's minimum touch target.
        className={cn('h-11', className)}
        {...input}
      />
      {description ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
      {errorId ? <FieldError id={errorId}>{errors?.[0]}</FieldError> : null}
    </Field>
  );
}

/** Disabled while submitting, so a double-click cannot send two requests. */
export function SubmitButton({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="h-11 w-full"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}
