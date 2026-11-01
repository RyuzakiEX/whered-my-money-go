/**
 * Account input schemas (M2-B04) — the contract between the account form
 * (M2-F02) and the account actions (M2-B06).
 *
 * Strict, so a submitted `user_id` is an error: ownership comes from the
 * session, never from input. There is no `currency` field either: an account
 * takes the user's profile currency, chosen by the action. Each schema is built
 * for that currency, because the opening balance is parsed in it — `15.5` is a
 * fine PHP amount and an impossible JPY one.
 *
 * Mirrors the database checks on `public.accounts`, which stay as the
 * backstop; these produce the field errors a user actually sees.
 */

import { z } from 'zod';

import type { SupportedCurrency } from '@/lib/core/money/currency';
import { currencyExponent } from '@/lib/core/money/currency';
import {
  parseMoneyToMinor,
  type ParseMoneyError,
} from '@/lib/core/money/parse';
import { ACCOUNT_TYPES, type AccountType } from '@/lib/core/types';
import type { Database } from '@/types/database';

/** True only when A and B are the same set of literals. */
type SameSet<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * `ACCOUNT_TYPES`, typed so this file stops compiling when the domain union
 * and the generated database enum differ in either direction. A value added
 * by a migration but not to `AccountType` (or the reverse) is a type error
 * here rather than an account the app cannot render.
 */
const accountTypes: SameSet<
  AccountType,
  Database['public']['Enums']['account_type']
> extends true
  ? typeof ACCOUNT_TYPES
  : never = ACCOUNT_TYPES;

export const ACCOUNT_MESSAGES = {
  nameRequired: 'Give the account a name.',
  nameTooLong: "That name's a bit long. 60 characters max, please.",
  typeUnknown: 'Pick an account type from the list.',
  idInvalid: "We couldn't find that account.",
  /** Names the existing account, which may differ from the input in case. */
  nameTaken: (existing: string) =>
    `You already have an account called "${existing}". Pick a different name.`,
  openingBalance: {
    empty: 'Enter what the account holds today. 0 is fine.',
    not_a_number:
      "That doesn't look like an amount. Try something like 1,250.50.",
    too_many_decimals: (currency: SupportedCurrency) => {
      const places = currencyExponent(currency);
      return places === 0
        ? `${currency} amounts have no decimal places.`
        : `${currency} amounts have at most ${String(places)} decimal places.`;
    },
    ambiguous_separators:
      "We couldn't tell where the decimal point is. Try writing it as 1250.50.",
    foreign_currency: (currency: SupportedCurrency) =>
      `Enter it in ${currency}, the currency of your account.`,
    out_of_range: 'That amount is too large for us to store exactly.',
  },
} as const;

function openingBalanceMessage(
  reason: ParseMoneyError,
  currency: SupportedCurrency,
): string {
  const messages = ACCOUNT_MESSAGES.openingBalance;
  switch (reason) {
    case 'too_many_decimals':
    case 'foreign_currency':
      return messages[reason](currency);
    default:
      return messages[reason];
  }
}

function accountFields(currency: SupportedCurrency) {
  return {
    name: z
      .string()
      .trim()
      .min(1, { error: ACCOUNT_MESSAGES.nameRequired })
      .max(60, { error: ACCOUNT_MESSAGES.nameTooLong }),

    type: z.enum(accountTypes, { error: ACCOUNT_MESSAGES.typeUnknown }),

    /** Decimal text as typed, parsed once here into integer minor units. */
    openingBalance: z.string().transform((text, ctx) => {
      const parsed = parseMoneyToMinor(text, currency);
      if (!parsed.ok) {
        ctx.issues.push({
          code: 'custom',
          message: openingBalanceMessage(parsed.reason, currency),
          input: text,
        });
        return z.NEVER;
      }
      return parsed.minor;
    }),

    excludeFromSafeToSpend: z.boolean(),
  };
}

const accountId = z.uuid({ error: ACCOUNT_MESSAGES.idInvalid });

/**
 * Renames the parsed balance so the output carries the `Minor` suffix — the
 * review signal that the number is integer minor units (money-and-rounding.md).
 * Errors keep the form field's name, `openingBalance`.
 */
function withMinorBalance<T extends { openingBalance: number }>({
  openingBalance,
  ...rest
}: T): Omit<T, 'openingBalance'> & { openingBalanceMinor: number } {
  return { ...rest, openingBalanceMinor: openingBalance };
}

/**
 * Unset, a savings account starts excluded from Safe to Spend — an emergency
 * fund is not spending money (data-model.md decision 5) — and anything else
 * starts included. The form shows that default; the user can override it.
 */
export function accountCreateSchema(currency: SupportedCurrency) {
  return z
    .strictObject({
      ...accountFields(currency),
      excludeFromSafeToSpend: z.boolean().optional(),
    })
    .transform(({ excludeFromSafeToSpend, ...rest }) =>
      withMinorBalance({
        ...rest,
        excludeFromSafeToSpend:
          excludeFromSafeToSpend ?? rest.type === 'savings',
      }),
    );
}

export function accountUpdateSchema(currency: SupportedCurrency) {
  return z
    .strictObject({ id: accountId, ...accountFields(currency) })
    .transform(withMinorBalance);
}

/** Archive, restore, and delete name an account and nothing else. */
export const accountIdSchema = z.strictObject({ id: accountId });

export type AccountCreateInput = z.input<
  ReturnType<typeof accountCreateSchema>
>;
export type AccountCreate = z.output<ReturnType<typeof accountCreateSchema>>;
export type AccountUpdateInput = z.input<
  ReturnType<typeof accountUpdateSchema>
>;
export type AccountUpdate = z.output<ReturnType<typeof accountUpdateSchema>>;
export type AccountIdInput = z.input<typeof accountIdSchema>;
