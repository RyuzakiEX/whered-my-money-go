import { describe, expect, it } from 'vitest';

import { ACCOUNT_TYPES } from '@/lib/core/types';
import {
  ACCOUNT_MESSAGES,
  accountCreateSchema,
  accountIdSchema,
  accountUpdateSchema,
  openingBalanceMinorOf,
} from '@/lib/validation/accounts';

/**
 * M2-B04: the account contract, consumed by the account actions (M2-B06) and
 * the create/edit form (M2-F02).
 */

function messageFor(
  result: { error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string,
): string | undefined {
  return result.error?.issues.find((i) => i.path[0] === field)?.message;
}

const php = accountCreateSchema('PHP');
const valid = {
  name: 'GCash',
  type: 'ewallet',
  openingBalance: '1,250.50',
  excludeFromSafeToSpend: false,
};
const ID = '0b6f3a4e-8f1c-4c2a-9d3e-5a7b8c9d0e1f';

describe('accountCreateSchema', () => {
  it('parses a complete account, with the balance in integer minor units', () => {
    expect(php.safeParse(valid).data).toEqual({
      name: 'GCash',
      type: 'ewallet',
      openingBalanceMinor: 125_050,
      excludeFromSafeToSpend: false,
    });
  });

  // The edge cases M2-B04 names, through the shared parser.
  it.each([
    ['0', 0],
    ['1000', 100_000],
    ['1000.5', 100_050],
    ['1000.55', 100_055],
    ['-500', -50_000],
    ['1,000.00', 100_000],
    ['₱1,000.00', 100_000],
    ['(500)', -50_000],
  ])('turns %j into %d minor units', (openingBalance, minor) => {
    expect(
      php.safeParse({ ...valid, openingBalance }).data?.openingBalanceMinor,
    ).toBe(minor);
  });

  it.each([
    ['abc', ACCOUNT_MESSAGES.openingBalance.not_a_number],
    ['', ACCOUNT_MESSAGES.openingBalance.empty],
    ['   ', ACCOUNT_MESSAGES.openingBalance.empty],
    ['1000.555', ACCOUNT_MESSAGES.openingBalance.too_many_decimals('PHP')],
    ['1.2.3', ACCOUNT_MESSAGES.openingBalance.ambiguous_separators],
    ['$1,000', ACCOUNT_MESSAGES.openingBalance.foreign_currency('PHP')],
  ])('rejects %j with its own message', (openingBalance, message) => {
    const result = php.safeParse({ ...valid, openingBalance });
    expect(messageFor(result, 'openingBalance')).toBe(message);
  });

  it("parses in the account's currency: JPY has no minor unit", () => {
    const jpy = accountCreateSchema('JPY');
    expect(
      jpy.safeParse({ ...valid, openingBalance: '1,500' }).data
        ?.openingBalanceMinor,
    ).toBe(1500);
    expect(
      messageFor(
        jpy.safeParse({ ...valid, openingBalance: '15.5' }),
        'openingBalance',
      ),
    ).toBe(ACCOUNT_MESSAGES.openingBalance.too_many_decimals('JPY'));
  });

  it('rejects a balance a JS number cannot hold exactly', () => {
    const result = php.safeParse({
      ...valid,
      openingBalance: '999999999999999999',
    });
    expect(messageFor(result, 'openingBalance')).toBe(
      ACCOUNT_MESSAGES.openingBalance.out_of_range,
    );
  });

  it.each(ACCOUNT_TYPES)('accepts type %s', (type) => {
    expect(php.safeParse({ ...valid, type }).success).toBe(true);
  });

  it.each(['gcash', 'GCASH', 'wallet', ''])('rejects type %j', (type) => {
    expect(messageFor(php.safeParse({ ...valid, type }), 'type')).toBe(
      ACCOUNT_MESSAGES.typeUnknown,
    );
  });

  it('trims the name', () => {
    expect(php.safeParse({ ...valid, name: '  GCash  ' }).data?.name).toBe(
      'GCash',
    );
  });

  it.each(['', '   '])('rejects a blank name %j', (name) => {
    expect(messageFor(php.safeParse({ ...valid, name }), 'name')).toBe(
      ACCOUNT_MESSAGES.nameRequired,
    );
  });

  it('accepts 60 characters and rejects 61, the database limit', () => {
    expect(php.safeParse({ ...valid, name: 'x'.repeat(60) }).success).toBe(
      true,
    );
    expect(
      messageFor(php.safeParse({ ...valid, name: 'x'.repeat(61) }), 'name'),
    ).toBe(ACCOUNT_MESSAGES.nameTooLong);
  });

  it.each([
    'user_id',
    'userId',
    'currency',
    'id',
    'archivedAt',
    'balanceMinor',
  ])(
    'rejects a submitted %s: ownership, currency, and state never come from this form',
    (key) => {
      const result = php.safeParse({ ...valid, [key]: 'x' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    },
  );

  it('defaults a savings account to excluded from Safe to Spend when unset', () => {
    const unset = { name: valid.name, openingBalance: valid.openingBalance };
    expect(
      php.safeParse({ ...unset, type: 'savings' }).data?.excludeFromSafeToSpend,
    ).toBe(true);
    expect(
      php.safeParse({ ...unset, type: 'bank' }).data?.excludeFromSafeToSpend,
    ).toBe(false);
  });

  it('keeps an explicit choice, savings or not', () => {
    expect(
      php.safeParse({
        ...valid,
        type: 'savings',
        excludeFromSafeToSpend: false,
      }).data?.excludeFromSafeToSpend,
    ).toBe(false);
    expect(
      php.safeParse({ ...valid, type: 'cash', excludeFromSafeToSpend: true })
        .data?.excludeFromSafeToSpend,
    ).toBe(true);
  });

  it('requires every field but the Safe to Spend choice', () => {
    for (const key of ['name', 'type', 'openingBalance']) {
      const partial = Object.fromEntries(
        Object.entries(valid).filter(([k]) => k !== key),
      );
      expect(php.safeParse(partial).success, key).toBe(false);
    }
  });
});

describe('accountUpdateSchema', () => {
  const update = accountUpdateSchema('PHP');

  it('is the create contract plus the id of the account to change', () => {
    expect(update.safeParse({ ...valid, id: ID }).data).toEqual({
      id: ID,
      name: 'GCash',
      type: 'ewallet',
      openingBalanceMinor: 125_050,
      excludeFromSafeToSpend: false,
    });
  });

  it('rejects a missing or malformed id', () => {
    expect(update.safeParse(valid).success).toBe(false);
    expect(
      messageFor(update.safeParse({ ...valid, id: 'not-a-uuid' }), 'id'),
    ).toBe(ACCOUNT_MESSAGES.idInvalid);
  });

  it.each(['user_id', 'currency'])('stays strict: rejects %s', (key) => {
    const result = update.safeParse({ ...valid, id: ID, [key]: 'x' });
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('accountIdSchema', () => {
  it('accepts an id and nothing else', () => {
    expect(accountIdSchema.safeParse({ id: ID }).data).toEqual({ id: ID });
    expect(accountIdSchema.safeParse({ id: ID, user_id: 'x' }).success).toBe(
      false,
    );
    expect(accountIdSchema.safeParse({ id: '1' }).success).toBe(false);
  });
});

describe('openingBalanceMinorOf', () => {
  it.each([
    ['1000.50', 100_050],
    ['1,000.50', 100_050],
    ['1000.5', 100_050],
    ['-2,500', -250_000],
  ] as const)('%s -> %d', (text, minor) => {
    expect(openingBalanceMinorOf(text, 'PHP')).toBe(minor);
  });

  it.each(['', 'abc', '1.5'])('%j -> null in JPY', (text) => {
    expect(openingBalanceMinorOf(text, 'JPY')).toBeNull();
  });
});
