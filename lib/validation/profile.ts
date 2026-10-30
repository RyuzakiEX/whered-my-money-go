/**
 * Profile input schema (M1-B04) — the contract between the Settings > Profile
 * form (M1-F05) and `updateProfile` (M1-B07).
 *
 * Strict, so a submitted `id` or `user_id` is an error: the row to update
 * comes from the session, never from input. Mirrors the database checks on
 * `public.profiles`, which stay as the backstop — these produce the field
 * errors a user actually sees.
 */

import { z } from 'zod';

import { SUPPORTED_CURRENCIES } from '@/lib/core/money/currency';

import { canonicalTimeZone } from './timezone';

export const PROFILE_MESSAGES = {
  displayNameTooLong: "That name's a bit long. 80 characters max, please.",
  currencyUnsupported: `Pick one of the currencies we support: ${SUPPORTED_CURRENCIES.join(', ')}.`,
  timezoneUnknown:
    "We couldn't find that timezone. Try picking one from the list.",
} as const;

export const profileUpdateSchema = z.strictObject({
  /** Trimmed; blank or null clears it. */
  displayName: z
    .string()
    .trim()
    .max(80, { error: PROFILE_MESSAGES.displayNameTooLong })
    .nullable()
    .transform((name) => (name === null || name === '' ? null : name)),

  /** The MVP allowlist — the same list as `profiles_currency_allowed`. */
  currency: z.enum(SUPPORTED_CURRENCIES, {
    error: PROFILE_MESSAGES.currencyUnsupported,
  }),

  /** A real IANA zone, stored in its canonical spelling. */
  timezone: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const canonical = canonicalTimeZone(value);
      if (canonical === null) {
        ctx.issues.push({
          code: 'custom',
          message: PROFILE_MESSAGES.timezoneUnknown,
          input: value,
        });
        return z.NEVER;
      }
      return canonical;
    }),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
