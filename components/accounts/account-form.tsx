'use client';

// The account form (M2-F02). ONE component for create and edit: the modes
// differ only in initial values, the submit label, the schema, and the
// action the page hands in. There is one field list.
//
// Validation is the action's own schema (lib/validation/accounts), built for
// the account's currency: checked per field on blur and in full on submit, so
// the form and the server cannot disagree. The opening balance stays decimal
// text here; the shared parser turns it into minor units, on submit here and
// again in the action.

import { useState, useTransition, type SubmitEvent } from 'react';

import {
  ErrorSummary,
  SELECT_CLASSES,
  TextField,
} from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { DialogClose, DialogFooter } from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { SupportedCurrency } from '@/lib/core/money/currency';
import { ACCOUNT_TYPES, type AccountType } from '@/lib/core/types';
import { currencySymbol } from '@/lib/utils/format-money';
import {
  accountCreateSchema,
  accountUpdateSchema,
} from '@/lib/validation/accounts';

import { ACCOUNT_TYPE_LABELS } from './account-types';

/** What the form edits and sends. The id, in edit mode, is bound by the page. */
export interface AccountFormValues {
  name: string;
  type: AccountType;
  /** Decimal text as typed, e.g. `1,000.50`. */
  openingBalance: string;
  excludeFromSafeToSpend: boolean;
}

export type AccountSaveResult =
  | { ok: true }
  | { ok: false; fields?: Record<string, string[]>; message?: string };

type FieldName = keyof AccountFormValues;
const FIELD_ORDER: readonly FieldName[] = [
  'name',
  'type',
  'openingBalance',
  'excludeFromSafeToSpend',
];

/** The select's labels: the card's, except e-wallet names its examples. */
const TYPE_OPTION_LABELS: Readonly<Record<AccountType, string>> = {
  ...ACCOUNT_TYPE_LABELS,
  ewallet: 'E-wallet (GCash, Maya)',
};

const NETWORK_FAILURE =
  "We couldn't reach the server. Your details are still here; try again.";

export const EMPTY_ACCOUNT: AccountFormValues = {
  name: '',
  type: 'cash',
  openingBalance: '',
  excludeFromSafeToSpend: false,
};

export function AccountForm({
  mode,
  accountId,
  initial,
  currency,
  saveAction,
  onSaved,
}: {
  mode: 'create' | 'edit';
  /** Edit mode only: validated with the update schema, which requires it. */
  accountId?: string;
  initial: AccountFormValues;
  /** The account's currency: the profile's for a new account. */
  currency: SupportedCurrency;
  saveAction: (values: AccountFormValues) => Promise<AccountSaveResult>;
  onSaved: (values: AccountFormValues) => void;
}) {
  const [values, setValues] = useState(initial);
  // Create mode follows the type's default until the user decides: a savings
  // account starts excluded (data-model.md decision 5), anything else not.
  const [excludeTouched, setExcludeTouched] = useState(mode === 'edit');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [message, setMessage] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const pristine = FIELD_ORDER.every((key) => values[key] === initial[key]);
  const balanceChanged =
    mode === 'edit' && values.openingBalance !== initial.openingBalance;

  /** Every field's first error under the action's own schema. */
  function validate(
    next: AccountFormValues,
  ): Partial<Record<FieldName, string>> {
    const result =
      mode === 'create'
        ? accountCreateSchema(currency).safeParse(next)
        : accountUpdateSchema(currency).safeParse({ ...next, id: accountId });
    const found: Partial<Record<FieldName, string>> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = issue.path[0] as FieldName;
        found[key] ??= issue.message;
      }
    }
    return found;
  }

  function set<K extends FieldName>(key: K, value: AccountFormValues[K]) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'type' && !excludeTouched) {
        next.excludeFromSafeToSpend = value === 'savings';
      }
      return next;
    });
  }

  function onBlur(key: FieldName) {
    // Do not shout at a field the user tabbed past without typing.
    if (values[key] === '' && !(key in errors)) return;
    const found = validate(values);
    setErrors((previous) => {
      const next = { ...previous };
      if (found[key]) next[key] = found[key];
      else Reflect.deleteProperty(next, key);
      return next;
    });
  }

  function focusField(key: FieldName) {
    document.getElementById(key)?.focus();
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    const found = validate(values);
    const firstInvalid = FIELD_ORDER.find((key) => found[key]);
    setErrors(found);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    startTransition(async () => {
      let result: AccountSaveResult;
      try {
        result = await saveAction(values);
      } catch {
        result = { ok: false, message: NETWORK_FAILURE };
      }
      if (result.ok) {
        onSaved(values);
        return;
      }
      // The server's field errors (a taken name) sit on their fields.
      const serverErrors: Partial<Record<FieldName, string>> = {};
      for (const key of FIELD_ORDER) {
        const first = result.fields?.[key]?.[0];
        if (first) serverErrors[key] = first;
      }
      setErrors(serverErrors);
      const firstServerError = FIELD_ORDER.find((key) => serverErrors[key]);
      if (firstServerError) focusField(firstServerError);
      setMessage(
        result.message ??
          (firstServerError
            ? undefined
            : "We couldn't save that. Nothing changed; try again."),
      );
    });
  }

  const balanceDescribedBy =
    [
      'openingBalance-description',
      balanceChanged ? 'openingBalance-note' : null,
      errors.openingBalance ? 'openingBalance-error' : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <ErrorSummary message={message} />

      <TextField
        name="name"
        label="Name"
        autoComplete="off"
        maxLength={80}
        description="What you call it, like GCash or BPI Savings."
        value={values.name}
        onChange={(e) => {
          set('name', e.target.value);
        }}
        onBlur={() => {
          onBlur('name');
        }}
        errors={errors.name ? [errors.name] : undefined}
      />

      <Field data-invalid={errors.type ? true : undefined}>
        <FieldLabel htmlFor="type">Type</FieldLabel>
        <select
          id="type"
          name="type"
          className={SELECT_CLASSES}
          value={values.type}
          aria-invalid={errors.type ? true : undefined}
          aria-describedby={errors.type ? 'type-error' : undefined}
          onChange={(e) => {
            set('type', e.target.value as AccountType);
          }}
          onBlur={() => {
            onBlur('type');
          }}
        >
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_OPTION_LABELS[type]}
            </option>
          ))}
        </select>
        {errors.type ? (
          <FieldError id="type-error">{errors.type}</FieldError>
        ) : null}
      </Field>

      <Field data-invalid={errors.openingBalance ? true : undefined}>
        <FieldLabel htmlFor="openingBalance">Opening balance</FieldLabel>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
          >
            {currencySymbol(currency)}
          </span>
          <Input
            id="openingBalance"
            name="openingBalance"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="h-11 pl-8"
            value={values.openingBalance}
            aria-invalid={errors.openingBalance ? true : undefined}
            aria-describedby={balanceDescribedBy}
            onChange={(e) => {
              set('openingBalance', e.target.value);
            }}
            onBlur={() => {
              onBlur('openingBalance');
            }}
          />
        </div>
        <FieldDescription id="openingBalance-description">
          What it holds today, in {currency}. Owe on a card? Put a minus, like
          -2,500.
        </FieldDescription>
        {balanceChanged ? (
          <FieldDescription id="openingBalance-note">
            Heads up: the balance shown will shift by the same amount you change
            this by.
          </FieldDescription>
        ) : null}
        {errors.openingBalance ? (
          <FieldError id="openingBalance-error">
            {errors.openingBalance}
          </FieldError>
        ) : null}
      </Field>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Currency</span>
        <span className="text-sm">
          {currency} ({currencySymbol(currency)})
        </span>
        <span className="text-sm text-muted-foreground">
          {mode === 'create'
            ? 'Every account uses your profile currency. You can change it in Settings.'
            : 'An account keeps the currency it was added in.'}
        </span>
      </div>

      <label
        htmlFor="excludeFromSafeToSpend"
        className="flex min-h-11 cursor-pointer items-start gap-3"
      >
        <input
          id="excludeFromSafeToSpend"
          name="excludeFromSafeToSpend"
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-primary"
          checked={values.excludeFromSafeToSpend}
          aria-describedby="excludeFromSafeToSpend-description"
          onChange={(e) => {
            setExcludeTouched(true);
            set('excludeFromSafeToSpend', e.target.checked);
          }}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            Leave out of Safe to Spend
          </span>
          <span
            id="excludeFromSafeToSpend-description"
            className="text-sm text-muted-foreground"
          >
            For money you&apos;re setting aside, like an emergency fund. It
            still shows here, just not in your spendable total.
          </span>
        </span>
      </label>

      <DialogFooter className="max-sm:rounded-b-none">
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-11">
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="submit"
          className={cn('h-11', pending && 'cursor-progress')}
          disabled={pristine || pending}
          aria-disabled={pristine || pending}
        >
          {pending
            ? 'Saving…'
            : mode === 'create'
              ? 'Add account'
              : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}
