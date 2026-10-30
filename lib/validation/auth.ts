/**
 * Auth input schemas (M1-B04) — the contract between the auth forms
 * (M1-F01..F03) and the auth Server Actions (M1-B05).
 *
 * Every schema is strict: an unknown key is an error, never silently
 * stripped (docs/architecture/api-and-data-access.md#reject-unknown-fields).
 * The messages below are the ONLY copy for these fields, shown inline by the
 * forms and returned by the actions, so the two cannot drift. Voice per spec
 * §32: friendly, non-judgmental, never scolding.
 */

import { z } from 'zod';

export const AUTH_MESSAGES = {
  emailRequired: "We'll need your email for this one.",
  emailInvalid: "That doesn't look like an email address. Mind checking it?",
  passwordRequired: "Don't forget your password.",
  passwordTooShort: 'Make it at least 8 characters. Future-you will thank you.',
  passwordComposition: 'Mix in at least one letter and one number.',
  passwordTooLong:
    "That's a lot of password. Keep it to 72 characters or fewer.",
  passwordMismatch:
    "Those two passwords don't match. Happens to the best of us.",
  displayNameTooLong: "That name's a bit long. 80 characters max, please.",
} as const;

/** Trimmed and lowercased, so `Ana@Example.com ` and `ana@example.com` are one account. */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { error: AUTH_MESSAGES.emailRequired })
  .pipe(z.email({ error: AUTH_MESSAGES.emailInvalid }));

/**
 * The password rule for any NEW password: 8 to 72 characters, with at least
 * one letter and one number. 72 is bcrypt's input limit — Supabase Auth
 * hashes with bcrypt, which silently ignores anything past it. Never trimmed:
 * a leading space is a character the user chose.
 */
const newPassword = z
  .string()
  .min(8, { error: AUTH_MESSAGES.passwordTooShort })
  .max(72, { error: AUTH_MESSAGES.passwordTooLong })
  .regex(/[A-Za-z]/, { error: AUTH_MESSAGES.passwordComposition })
  .regex(/\d/, { error: AUTH_MESSAGES.passwordComposition });

/** Optional at sign-up: trimmed, a blank value means "not given". */
const optionalDisplayName = z
  .string()
  .trim()
  .max(80, { error: AUTH_MESSAGES.displayNameTooLong })
  .optional()
  .transform((name) => (name === '' ? undefined : name));

export const signUpSchema = z.strictObject({
  email,
  password: newPassword,
  displayName: optionalDisplayName,
});

/**
 * Login checks presence only. Re-checking the composition rule would lock
 * out anyone whose password predates a rule change, and would hint at what a
 * valid password looks like.
 */
export const signInSchema = z.strictObject({
  email,
  password: z.string().min(1, { error: AUTH_MESSAGES.passwordRequired }),
});

export const passwordResetRequestSchema = z.strictObject({ email });

export const passwordUpdateSchema = z
  .strictObject({
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    error: AUTH_MESSAGES.passwordMismatch,
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type PasswordResetRequestInput = z.infer<
  typeof passwordResetRequestSchema
>;
export type PasswordUpdateInput = z.infer<typeof passwordUpdateSchema>;
