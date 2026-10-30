'use client';

// Settings > Profile (M1-F05).
//
// Optimistic: the new values show as saved the moment you press Save. If the
// action fails, React's useOptimistic drops the optimistic values when the
// transition ends, so the previous ones come back, and the error is
// announced. Validation uses the same schema as updateProfile.

import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type SubmitEvent,
} from 'react';

import { ErrorSummary, TextField } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { SUPPORTED_CURRENCIES } from '@/lib/core/money/currency';
import { profileUpdateSchema } from '@/lib/validation/profile';

export interface ProfileValues {
  displayName: string | null;
  currency: (typeof SUPPORTED_CURRENCIES)[number];
  timezone: string;
}

export type ProfileSaveResult =
  | { ok: true; data: ProfileValues }
  | { ok: false; fields?: Record<string, string[]>; message?: string };

const CURRENCY_NAMES: Record<ProfileValues['currency'], string> = {
  PHP: 'Philippine peso (₱)',
  USD: 'US dollar ($)',
  EUR: 'Euro (€)',
  JPY: 'Japanese yen (¥)',
};

const SAVED = 'Saved. Looking good.';
const SELECT_CLASSES =
  'h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30';

export function ProfileForm({
  initial,
  timezones,
  saveAction,
}: {
  initial: ProfileValues;
  timezones: readonly string[];
  /** The page's adapter around updateProfile. */
  saveAction: (values: ProfileValues) => Promise<ProfileSaveResult>;
}) {
  const [saved, setSaved] = useState<ProfileValues>(initial);
  const [shown, showOptimistic] = useOptimistic(saved);
  const [values, setValues] = useState<ProfileValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | undefined>();
  const [status, setStatus] = useState('');
  const [pending, startTransition] = useTransition();

  // After a failed save, put the inputs back to what is actually saved.
  const rollbackTo = useRef<ProfileValues | null>(null);
  useEffect(() => {
    if (!pending && rollbackTo.current) {
      setValues(rollbackTo.current);
      rollbackTo.current = null;
    }
  }, [pending]);

  const dirty =
    values.displayName !== saved.displayName ||
    values.currency !== saved.currency ||
    values.timezone !== saved.timezone;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setStatus('');
    const parsed = profileUpdateSchema.safeParse(values);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        (errors[String(issue.path[0])] ??= []).push(issue.message);
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    const next = parsed.data;
    const previous = saved;

    startTransition(async () => {
      showOptimistic(next);
      const result = await saveAction(next);
      if (result.ok) {
        setSaved(result.data);
        setValues(result.data);
        setStatus(SAVED);
      } else {
        rollbackTo.current = previous;
        setFieldErrors(result.fields ?? {});
        setMessage(
          result.message ??
            "We couldn't save that. Your previous settings are still in place.",
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="current-heading"
        className="rounded-lg border p-4"
      >
        <h2
          id="current-heading"
          className="text-sm font-medium text-muted-foreground"
        >
          Currently saved
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd data-testid="shown-name">{shown.displayName ?? 'Not set'}</dd>
          <dt className="text-muted-foreground">Currency</dt>
          <dd data-testid="shown-currency">{shown.currency}</dd>
          <dt className="text-muted-foreground">Timezone</dt>
          <dd data-testid="shown-timezone">{shown.timezone}</dd>
        </dl>
      </section>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ErrorSummary message={message} />
        <TextField
          name="displayName"
          label="Name"
          autoComplete="nickname"
          value={values.displayName ?? ''}
          onChange={(e) => {
            setValues({ ...values, displayName: e.target.value });
          }}
          errors={fieldErrors['displayName']}
        />

        <Field>
          <FieldLabel htmlFor="currency">Currency</FieldLabel>
          <select
            id="currency"
            name="currency"
            className={SELECT_CLASSES}
            value={values.currency}
            aria-describedby={
              values.currency !== saved.currency ? 'currency-note' : undefined
            }
            onChange={(e) => {
              setValues({
                ...values,
                currency: e.target.value as ProfileValues['currency'],
              });
            }}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {CURRENCY_NAMES[code]}
              </option>
            ))}
          </select>
          {values.currency !== saved.currency ? (
            <FieldDescription id="currency-note">
              Heads up: this won&apos;t convert amounts you&apos;ve already
              entered. You keep one currency for now.
            </FieldDescription>
          ) : null}
        </Field>

        <TextField
          name="timezone"
          label="Timezone"
          list="timezone-options"
          autoComplete="off"
          description="Start typing a city, like Manila or New York."
          value={values.timezone}
          onChange={(e) => {
            setValues({ ...values, timezone: e.target.value });
          }}
          errors={fieldErrors['timezone']}
        />
        <datalist id="timezone-options">
          {timezones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>

        <Button
          type="submit"
          className="h-11 w-full"
          disabled={!dirty || pending}
          aria-disabled={!dirty || pending}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {/* Polite: announced without moving focus mid-typing. */}
        <p role="status" className="min-h-5 text-sm text-muted-foreground">
          {status}
        </p>
      </form>
    </div>
  );
}
