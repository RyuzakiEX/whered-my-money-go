import { describe, expect, it } from 'vitest';

import {
  AUTH_MESSAGES,
  passwordResetRequestSchema,
  passwordUpdateSchema,
  signInSchema,
  signUpSchema,
} from '@/lib/validation/auth';

/**
 * M1-B04: the auth contract. These schemas are the single source of copy and
 * rules for the sign-up/login/reset forms (M1-F01..F03) and the Server
 * Actions (M1-B05), so a form and its action cannot disagree.
 */

/** The first issue's message for a given field, or undefined. */
function messageFor(
  result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  },
  field: string,
): string | undefined {
  return result.error?.issues.find((i) => i.path[0] === field)?.message;
}

const valid = { email: 'ana@example.com', password: 'hunter22' };

describe('signUpSchema', () => {
  it('accepts email and password, and normalises the email', () => {
    const result = signUpSchema.safeParse({
      email: '  Ana@Example.COM ',
      password: 'hunter22',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      email: 'ana@example.com',
      password: 'hunter22',
    });
  });

  it('accepts an optional display name, trimmed', () => {
    const result = signUpSchema.safeParse({ ...valid, displayName: '  Ana  ' });
    expect(result.data?.displayName).toBe('Ana');
  });

  it('treats a blank display name as absent', () => {
    const result = signUpSchema.safeParse({ ...valid, displayName: '   ' });
    expect(result.success).toBe(true);
    expect(result.data?.displayName).toBeUndefined();
  });

  it.each([
    ['', AUTH_MESSAGES.emailRequired],
    ['   ', AUTH_MESSAGES.emailRequired],
    ['not-an-email', AUTH_MESSAGES.emailInvalid],
    ['ana@', AUTH_MESSAGES.emailInvalid],
  ])('rejects email %j', (email, message) => {
    const result = signUpSchema.safeParse({ ...valid, email });
    expect(messageFor(result, 'email')).toBe(message);
  });

  it.each([
    ['short1', AUTH_MESSAGES.passwordTooShort],
    ['abcdefgh', AUTH_MESSAGES.passwordComposition], // no digit
    ['12345678', AUTH_MESSAGES.passwordComposition], // no letter
    [`a1${'x'.repeat(71)}`, AUTH_MESSAGES.passwordTooLong], // 73 characters
  ])('rejects password %j', (password, message) => {
    const result = signUpSchema.safeParse({ ...valid, password });
    expect(messageFor(result, 'password')).toBe(message);
  });

  it('accepts a password of exactly 8 and exactly 72 characters', () => {
    for (const password of ['abcdefg1', `a1${'x'.repeat(70)}`]) {
      expect(signUpSchema.safeParse({ ...valid, password }).success).toBe(true);
    }
  });

  it('does not trim a password: spaces are characters the user chose', () => {
    const result = signUpSchema.safeParse({ ...valid, password: ' hunter22 ' });
    expect(result.data?.password).toBe(' hunter22 ');
  });

  it('rejects a display name over 80 characters', () => {
    const result = signUpSchema.safeParse({
      ...valid,
      displayName: 'x'.repeat(81),
    });
    expect(messageFor(result, 'displayName')).toBe(
      AUTH_MESSAGES.displayNameTooLong,
    );
  });

  it('rejects unknown fields instead of stripping them', () => {
    const result = signUpSchema.safeParse({ ...valid, userId: 'someone-else' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('signInSchema', () => {
  it('accepts any non-empty password: login never re-checks the composition rule', () => {
    // Users created before a rule change must still be able to sign in, and
    // revealing the rule on login hints at what a valid password looks like.
    const result = signInSchema.safeParse({
      email: 'Ana@Example.com',
      password: 'x',
    });
    expect(result.data).toEqual({ email: 'ana@example.com', password: 'x' });
  });

  it('rejects an empty password', () => {
    const result = signInSchema.safeParse({
      email: 'ana@example.com',
      password: '',
    });
    expect(messageFor(result, 'password')).toBe(AUTH_MESSAGES.passwordRequired);
  });

  it('rejects unknown fields', () => {
    expect(signInSchema.safeParse({ ...valid, remember: true }).success).toBe(
      false,
    );
  });
});

describe('passwordResetRequestSchema', () => {
  it('accepts and normalises an email', () => {
    expect(
      passwordResetRequestSchema.safeParse({ email: ' A@B.co ' }).data,
    ).toEqual({
      email: 'a@b.co',
    });
  });

  it('rejects an invalid email', () => {
    const result = passwordResetRequestSchema.safeParse({ email: 'nope' });
    expect(messageFor(result, 'email')).toBe(AUTH_MESSAGES.emailInvalid);
  });
});

describe('passwordUpdateSchema', () => {
  it('accepts a new password with a matching confirmation', () => {
    const result = passwordUpdateSchema.safeParse({
      password: 'newpass99',
      confirmPassword: 'newpass99',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a mismatched confirmation, on the confirmation field', () => {
    const result = passwordUpdateSchema.safeParse({
      password: 'newpass99',
      confirmPassword: 'newpass98',
    });
    expect(result.success).toBe(false);
    expect(messageFor(result, 'confirmPassword')).toBe(
      AUTH_MESSAGES.passwordMismatch,
    );
    expect(messageFor(result, 'password')).toBeUndefined();
  });

  it('applies the sign-up password rule to the new password', () => {
    const result = passwordUpdateSchema.safeParse({
      password: 'short1',
      confirmPassword: 'short1',
    });
    expect(messageFor(result, 'password')).toBe(AUTH_MESSAGES.passwordTooShort);
  });
});

describe('copy', () => {
  it('never scolds: no message uses blame words or shouts', () => {
    for (const message of Object.values(AUTH_MESSAGES)) {
      expect(message).not.toMatch(/\b(invalid|wrong|error|must|failed)\b/i);
      expect(message).not.toMatch(/!{2,}|[A-Z]{4,}/);
    }
  });
});
