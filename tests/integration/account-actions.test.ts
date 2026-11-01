import { randomUUID } from 'node:crypto';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { TablesInsert } from '@/types/database';

/**
 * M2-B06: the account Server Actions against the local stack. Ownership comes
 * from the session; another user's account answers `not_found`, exactly like
 * an id that never existed, so ids cannot be probed.
 */

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => {
        if (value === '') jar.delete(name);
        else jar.set(name, value);
      },
    }),
}));

const updateTag = vi.fn();
vi.mock('next/cache', () => ({ updateTag }));

const { createAdminClient } = await import('@/lib/server/supabase/admin');
const { createServerSupabaseClient } =
  await import('@/lib/server/supabase/server');
const actions = await import('@/lib/server/actions/accounts');
const { listAccounts } = await import('@/lib/server/queries/accounts');
const { tags } = await import('@/lib/server/cache/tags');
const { ACCOUNT_MESSAGES } = await import('@/lib/validation/accounts');

const admin = createAdminClient();
const password = `pw-${randomUUID()}`;
const users: string[] = [];

async function createUser() {
  const email = `m2-b06-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  return { id: data.user.id, email };
}

async function signInAs(email: string) {
  jar.clear();
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function seed(
  userId: string,
  row: Partial<TablesInsert<'accounts'>> = {},
): Promise<string> {
  const { data, error } = await admin
    .from('accounts')
    .insert({
      user_id: userId,
      name: `Seeded ${randomUUID().slice(0, 8)}`,
      type: 'cash',
      currency: 'PHP',
      ...row,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function rowOf(id: string) {
  const { data, error } = await admin
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function accountCount(userId: string) {
  const { count, error } = await admin
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count;
}

function invalidated(): string[] {
  return updateTag.mock.calls.map(([tag]) => tag as string).sort();
}

const CHANGE_ROW = ['accounts', 'dashboard', 'sts', 'timeline'] as const;
const REMOVAL_ROW = [
  'accounts',
  'transactions',
  'recurring',
  'dashboard',
  'sts',
  'timeline',
] as const;
const tagsFor = (userId: string, row: readonly (keyof typeof tags)[]) =>
  row.map((name) => tags[name](userId)).sort();

const input = {
  name: 'GCash',
  type: 'ewallet',
  openingBalance: '1,250.50',
  excludeFromSafeToSpend: false,
};
const NOT_FOUND = {
  ok: false,
  error: { kind: 'not_found', entity: 'account' },
};

let a: { id: string; email: string };
let b: { id: string; email: string };

beforeAll(async () => {
  a = await createUser();
  b = await createUser();
});

beforeEach(async () => {
  updateTag.mockClear();
  await signInAs(a.email);
});

afterAll(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe('createAccount', () => {
  it("creates the account for the session's user, in the profile currency", async () => {
    const fresh = await createUser();
    await admin.from('profiles').update({ currency: 'USD' }).eq('id', fresh.id);
    await signInAs(fresh.email);

    const result = await actions.createAccount(input);

    expect(result.ok).toBe(true);
    const id = result.ok ? result.data.id : '';
    expect(await rowOf(id)).toMatchObject({
      user_id: fresh.id,
      name: 'GCash',
      type: 'ewallet',
      currency: 'USD',
      opening_balance_minor: 125_050,
      exclude_from_safe_to_spend: false,
      archived_at: null,
    });
    expect(invalidated()).toEqual(tagsFor(fresh.id, CHANGE_ROW));
  });

  it('refuses a submitted currency or user_id, and writes nothing', async () => {
    const before = await accountCount(a.id);
    for (const extra of [{ currency: 'USD' }, { user_id: b.id }]) {
      const result = await actions.createAccount({ ...input, ...extra });
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'validation' },
      });
    }
    expect(await accountCount(a.id)).toBe(before);
    expect(await accountCount(b.id)).toBe(0);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('answers a duplicate name with a field error naming the existing account', async () => {
    await seed(a.id, { name: 'Maya' });
    const before = await accountCount(a.id);

    const result = await actions.createAccount({ ...input, name: 'MAYA' });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        fields: { name: [ACCOUNT_MESSAGES.nameTaken('Maya')] },
      },
    });
    expect(await accountCount(a.id)).toBe(before);
  });

  it('answers a duplicate name containing LIKE wildcards with the right account', async () => {
    // The decoy first: an unescaped ILIKE would match it, and return it first.
    await seed(a.id, { name: '50X offYcard' });
    await seed(a.id, { name: '50% off_card' });
    const result = await actions.createAccount({
      ...input,
      name: '50% OFF_CARD',
    });
    expect(result).toMatchObject({
      error: { fields: { name: [ACCOUNT_MESSAGES.nameTaken('50% off_card')] } },
    });
  });

  it("names the right account when the name holds PostgREST's * wildcard", async () => {
    // Under PostgREST's ILIKE, `*` means `%`, so 'savings*' would also match
    // the decoy, which is seeded first.
    await seed(a.id, { name: 'SAVINGS fund' });
    await seed(a.id, { name: 'Savings*' });
    const result = await actions.createAccount({ ...input, name: 'savings*' });
    expect(result).toMatchObject({
      error: { fields: { name: [ACCOUNT_MESSAGES.nameTaken('Savings*')] } },
    });
  });

  it('answers unauthenticated when signed out, and writes nothing', async () => {
    jar.clear();
    expect(await actions.createAccount(input)).toEqual({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
  });
});

describe('updateAccount', () => {
  it('updates the allowlisted fields of the user’s own account', async () => {
    const id = await seed(a.id, { name: 'Wallet', opening_balance_minor: 100 });

    const result = await actions.updateAccount({
      id,
      name: 'Pocket',
      type: 'cash',
      openingBalance: '500',
      excludeFromSafeToSpend: true,
    });

    expect(result).toEqual({ ok: true, data: { id } });
    expect(await rowOf(id)).toMatchObject({
      user_id: a.id,
      name: 'Pocket',
      opening_balance_minor: 50_000,
      exclude_from_safe_to_spend: true,
      currency: 'PHP',
    });
    expect(invalidated()).toEqual(tagsFor(a.id, CHANGE_ROW));
  });

  it("parses the balance in the account's currency, not the profile's", async () => {
    const id = await seed(a.id, { currency: 'JPY' });
    const result = await actions.updateAccount({
      ...input,
      name: `Yen ${randomUUID().slice(0, 8)}`,
      id,
      openingBalance: '1,500',
    });
    expect(result.ok).toBe(true);
    expect((await rowOf(id))?.opening_balance_minor).toBe(1500);
  });

  it('lets an account change only the case of its own name', async () => {
    const id = await seed(a.id, { name: 'gotyme' });
    const result = await actions.updateAccount({
      ...input,
      id,
      name: 'GoTyme',
    });
    expect(result.ok).toBe(true);
  });

  it('answers a rename onto another account’s name with a field error', async () => {
    await seed(a.id, { name: 'Seabank' });
    const id = await seed(a.id, { name: 'Seabank 2' });
    const result = await actions.updateAccount({
      ...input,
      id,
      name: 'seabank',
    });
    expect(result).toMatchObject({
      error: { fields: { name: [ACCOUNT_MESSAGES.nameTaken('Seabank')] } },
    });
    expect((await rowOf(id))?.name).toBe('Seabank 2');
  });

  it('refuses to edit an archived account until it is restored', async () => {
    const id = await seed(a.id, {
      name: 'Shelved',
      archived_at: '2026-10-01T00:00:00+00:00',
    });
    const result = await actions.updateAccount({
      ...input,
      id,
      name: 'Unshelved',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'conflict',
        reason: 'account_archived',
        message: ACCOUNT_MESSAGES.archived,
      },
    });
    expect((await rowOf(id))?.name).toBe('Shelved');
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("answers not_found for another user's account, and leaves it untouched", async () => {
    const theirs = await seed(b.id, { name: 'Theirs' });
    const result = await actions.updateAccount({ ...input, id: theirs });
    expect(result).toEqual(NOT_FOUND);
    expect((await rowOf(theirs))?.name).toBe('Theirs');
    expect(await actions.updateAccount({ ...input, id: randomUUID() })).toEqual(
      NOT_FOUND,
    );
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe('archiveAccount and restoreAccount', () => {
  it('archives, idempotently, and the account leaves the default list', async () => {
    const id = await seed(a.id, {
      name: `Archive me ${randomUUID().slice(0, 8)}`,
    });

    expect(await actions.archiveAccount({ id })).toEqual({
      ok: true,
      data: { id },
    });
    const first = (await rowOf(id))?.archived_at;
    expect(first).not.toBeNull();
    expect(invalidated()).toEqual(tagsFor(a.id, REMOVAL_ROW));

    expect(await actions.archiveAccount({ id })).toEqual({
      ok: true,
      data: { id },
    });
    expect((await rowOf(id))?.archived_at).toBe(first);

    expect((await listAccounts()).some((acc) => acc.id === id)).toBe(false);
    expect(
      (await listAccounts({ includeArchived: true })).some(
        (acc) => acc.id === id,
      ),
    ).toBe(true);
  });

  it('restores, idempotently, and the account returns to the list', async () => {
    const id = await seed(a.id, { archived_at: '2026-10-01T00:00:00+00:00' });
    expect(await actions.restoreAccount({ id })).toEqual({
      ok: true,
      data: { id },
    });
    expect((await rowOf(id))?.archived_at).toBeNull();
    expect(await actions.restoreAccount({ id })).toEqual({
      ok: true,
      data: { id },
    });
    expect((await listAccounts()).some((acc) => acc.id === id)).toBe(true);
  });

  it("answers not_found for another user's account", async () => {
    const theirs = await seed(b.id);
    expect(await actions.archiveAccount({ id: theirs })).toEqual(NOT_FOUND);
    expect(await actions.restoreAccount({ id: theirs })).toEqual(NOT_FOUND);
    expect((await rowOf(theirs))?.archived_at).toBeNull();
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe('deleteAccount', () => {
  it("deletes the user's own account", async () => {
    const id = await seed(a.id);
    expect(await actions.deleteAccount({ id })).toEqual({
      ok: true,
      data: { id },
    });
    expect(await rowOf(id)).toBeNull();
    expect(invalidated()).toEqual(tagsFor(a.id, REMOVAL_ROW));
  });

  it("answers not_found for another user's account, which survives", async () => {
    const theirs = await seed(b.id);
    expect(await actions.deleteAccount({ id: theirs })).toEqual(NOT_FOUND);
    expect(await rowOf(theirs)).not.toBeNull();
    expect(await actions.deleteAccount({ id: randomUUID() })).toEqual(
      NOT_FOUND,
    );
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('refuses a malformed id as validation, before any query', async () => {
    expect(await actions.deleteAccount({ id: 'nope' })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
  });
});
