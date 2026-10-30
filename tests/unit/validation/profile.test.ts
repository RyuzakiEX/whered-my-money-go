import { describe, expect, it } from 'vitest';

import {
  PROFILE_MESSAGES,
  profileUpdateSchema,
} from '@/lib/validation/profile';

/**
 * M1-B04: the profile contract, consumed by updateProfile (M1-B07) and the
 * Settings > Profile form (M1-F05).
 */

function messageFor(
  result: { error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string,
): string | undefined {
  return result.error?.issues.find((i) => i.path[0] === field)?.message;
}

const valid = { displayName: 'Ana', currency: 'PHP', timezone: 'Asia/Manila' };

describe('profileUpdateSchema', () => {
  it('accepts a complete update', () => {
    expect(profileUpdateSchema.safeParse(valid).data).toEqual(valid);
  });

  it.each(['PHP', 'USD', 'EUR', 'JPY'])('accepts currency %s', (currency) => {
    expect(profileUpdateSchema.safeParse({ ...valid, currency }).success).toBe(
      true,
    );
  });

  it.each(['GBP', 'php', '', 'PHPX'])('rejects currency %j', (currency) => {
    const result = profileUpdateSchema.safeParse({ ...valid, currency });
    expect(messageFor(result, 'currency')).toBe(
      PROFILE_MESSAGES.currencyUnsupported,
    );
  });

  it.each([
    'Asia/Manila',
    'America/New_York',
    'Europe/Berlin',
    'UTC',
    'Etc/GMT+8',
  ])('accepts IANA zone %s', (timezone) => {
    expect(profileUpdateSchema.safeParse({ ...valid, timezone }).success).toBe(
      true,
    );
  });

  it('stores the canonical spelling of a zone', () => {
    const result = profileUpdateSchema.safeParse({
      ...valid,
      timezone: 'asia/manila',
    });
    expect(result.data?.timezone).toBe('Asia/Manila');
  });

  it.each([
    ['Not/AZone', 'a name that is not a zone'],
    ['+08:00', 'an offset, which does not survive DST or legislative change'],
    ['-05:00', 'a negative offset'],
    ['GMT+8', 'a bare offset-style name'],
    ['', 'blank'],
    ['   ', 'whitespace'],
  ])('rejects timezone %j (%s)', (timezone) => {
    const result = profileUpdateSchema.safeParse({ ...valid, timezone });
    expect(messageFor(result, 'timezone')).toBe(
      PROFILE_MESSAGES.timezoneUnknown,
    );
  });

  it('trims the display name, and clears it when blank or null', () => {
    expect(
      profileUpdateSchema.safeParse({ ...valid, displayName: '  Ana  ' }).data
        ?.displayName,
    ).toBe('Ana');
    expect(
      profileUpdateSchema.safeParse({ ...valid, displayName: '   ' }).data
        ?.displayName,
    ).toBeNull();
    expect(
      profileUpdateSchema.safeParse({ ...valid, displayName: null }).data
        ?.displayName,
    ).toBeNull();
  });

  it('rejects a display name over 80 characters', () => {
    const result = profileUpdateSchema.safeParse({
      ...valid,
      displayName: 'x'.repeat(81),
    });
    expect(messageFor(result, 'displayName')).toBe(
      PROFILE_MESSAGES.displayNameTooLong,
    );
  });

  it.each(['id', 'user_id', 'userId', 'onboardingCompletedAt', 'created_at'])(
    'rejects a submitted %s: ownership and bookkeeping never come from input',
    (key) => {
      const result = profileUpdateSchema.safeParse({ ...valid, [key]: 'x' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    },
  );

  it('requires all three fields', () => {
    for (const key of Object.keys(valid)) {
      const partial = Object.fromEntries(
        Object.entries(valid).filter(([k]) => k !== key),
      );
      expect(profileUpdateSchema.safeParse(partial).success).toBe(false);
    }
  });
});
