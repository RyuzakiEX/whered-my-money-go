import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminClient } from '@/lib/server/supabase/admin';
import type { Database } from '@/types/database';

import { LOCAL_ANON_KEY, LOCAL_API_URL } from './setup';

/**
 * M2-B01 and M2-B03: the `accounts` table and its RLS.
 *
 * Constraint checks use the admin client, which bypasses RLS but not
 * constraints. Ownership checks sign in as a real user through the anon key,
 * the path the browser takes. The pgTAP suite (supabase/tests/rls) covers the
 * same isolation inside the database, plus the schema's structure.
 */

type Client = SupabaseClient<Database>;
type AccountInsert = Database['public']['Tables']['accounts']['Insert'];

const admin = createAdminClient();
const created: string[] = [];

async function createUser() {
  const email = `m2-accounts-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function signedIn(user: {
  email: string;
  password: string;
}): Promise<Client> {
  const client = createClient<Database>(LOCAL_API_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword(user);
  if (error) throw error;
  return client;
}

function account(userId: string, overrides: Partial<AccountInsert> = {}) {
  return {
    user_id: userId,
    name: `Wallet ${randomUUID().slice(0, 8)}`,
    type: 'cash',
    currency: 'PHP',
    ...overrides,
  } satisfies AccountInsert;
}

async function insertAccount(
  userId: string,
  overrides: Partial<AccountInsert> = {},
) {
  const { data, error } = await admin
    .from('accounts')
    .insert(account(userId, overrides))
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function accountById(id: string) {
  const { data, error } = await admin
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('accounts table (M2-B01)', () => {
  let userId = '';
  beforeAll(async () => {
    userId = (await createUser()).id;
  });

  it('fills the defaults: zero opening balance, counted in Safe to Spend, not archived', async () => {
    const row = await insertAccount(userId);
    expect(row).toMatchObject({
      opening_balance_minor: 0,
      exclude_from_safe_to_spend: false,
      archived_at: null,
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });

  it.each(['cash', 'bank', 'ewallet', 'credit_card', 'savings', 'other'])(
    'accepts type %s',
    async (type) => {
      const { error } = await admin
        .from('accounts')
        .insert(account(userId, { type: type as AccountInsert['type'] }));
      expect(error).toBeNull();
    },
  );

  it.each(['gcash', 'maya', 'wallet', ''])(
    'rejects type %j: the enum is closed',
    async (type) => {
      const { error } = await admin
        .from('accounts')
        .insert(account(userId, { type: type as AccountInsert['type'] }));
      expect(error?.code).toBe('22P02'); // invalid_text_representation
    },
  );

  it('accepts a negative opening balance: a credit card opens in debt', async () => {
    const row = await insertAccount(userId, {
      type: 'credit_card',
      opening_balance_minor: -1_500_000,
    });
    expect(row.opening_balance_minor).toBe(-1_500_000);
  });

  it.each(['PHP', 'USD', 'EUR', 'JPY'])('accepts currency %s', async (c) => {
    const { error } = await admin
      .from('accounts')
      .insert(account(userId, { currency: c }));
    expect(error).toBeNull();
  });

  it.each(['GBP', 'php', 'PH', 'XXX'])('rejects currency %s', async (c) => {
    const { error } = await admin
      .from('accounts')
      .insert(account(userId, { currency: c }));
    expect(error?.code).toBe('23514'); // check_violation
    expect(error?.message).toContain('accounts_currency_allowed');
  });

  it.each(['', '   ', 'x'.repeat(61)])('rejects name %j', async (name) => {
    const { error } = await admin
      .from('accounts')
      .insert(account(userId, { name }));
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('accounts_name_length');
  });

  it('accepts a 60-character name', async () => {
    const { error } = await admin
      .from('accounts')
      .insert(account(userId, { name: randomUUID().padEnd(60, 'x') }));
    expect(error).toBeNull();
  });

  it('refuses a second account whose name differs only in case', async () => {
    await insertAccount(userId, { name: 'GCash' });
    const { error } = await admin
      .from('accounts')
      .insert(account(userId, { name: 'gcash' }));
    expect(error?.code).toBe('23505'); // unique_violation
    expect(error?.message).toContain('accounts_unique_name');
  });

  it('refuses the duplicate on rename too, not only on insert', async () => {
    await insertAccount(userId, { name: 'Maya' });
    const other = await insertAccount(userId, { name: 'Maya savings' });
    const { error } = await admin
      .from('accounts')
      .update({ name: 'MAYA' })
      .eq('id', other.id);
    expect(error?.code).toBe('23505');
  });

  it('lets two different users use the same name', async () => {
    const other = await createUser();
    await insertAccount(userId, { name: 'Cash' });
    await expect(
      insertAccount(other.id, { name: 'Cash' }),
    ).resolves.toBeTruthy();
  });

  it('records archived_at and clears it again', async () => {
    const row = await insertAccount(userId);
    const at = '2026-11-01T08:00:00+00:00';
    await admin.from('accounts').update({ archived_at: at }).eq('id', row.id);
    expect(Date.parse((await accountById(row.id))?.archived_at ?? '')).toBe(
      Date.parse(at),
    );
    await admin.from('accounts').update({ archived_at: null }).eq('id', row.id);
    expect((await accountById(row.id))?.archived_at).toBeNull();
  });

  it('moves updated_at forward on update and leaves created_at alone', async () => {
    const before = await insertAccount(userId);
    // timestamptz has microsecond precision; a short wait keeps the
    // comparison strict without depending on clock resolution.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await admin
      .from('accounts')
      .update({ name: `Renamed ${randomUUID().slice(0, 8)}` })
      .eq('id', before.id);
    const after = await accountById(before.id);
    expect(after?.created_at).toBe(before.created_at);
    expect(Date.parse(after?.updated_at ?? '')).toBeGreaterThan(
      Date.parse(before.updated_at),
    );
  });

  it("removes a user's accounts when the auth user is deleted", async () => {
    const gone = await createUser();
    const row = await insertAccount(gone.id);
    await admin.auth.admin.deleteUser(gone.id);
    expect(await accountById(row.id)).toBeNull();
  });
});

describe('accounts RLS (M2-B03)', () => {
  let a: Awaited<ReturnType<typeof createUser>>;
  let b: Awaited<ReturnType<typeof createUser>>;
  let asA: Client;
  let bAccountId = '';

  beforeAll(async () => {
    a = await createUser();
    b = await createUser();
    asA = await signedIn(a);
    bAccountId = (await insertAccount(b.id, { name: 'B private' })).id;
  });

  it('lets a user create, read, update, and delete their own account', async () => {
    const inserted = await asA
      .from('accounts')
      .insert(account(a.id, { name: 'Mine' }))
      .select('id')
      .single();
    expect(inserted.error).toBeNull();
    const id = inserted.data?.id ?? '';

    const read = await asA.from('accounts').select('name').eq('id', id);
    expect(read.data).toEqual([{ name: 'Mine' }]);

    const updated = await asA
      .from('accounts')
      .update({ name: 'Mine, renamed' })
      .eq('id', id)
      .select('name');
    expect(updated.data).toEqual([{ name: 'Mine, renamed' }]);

    const deleted = await asA.from('accounts').delete().eq('id', id).select();
    expect(deleted.data).toHaveLength(1);
  });

  it("hides another user's accounts", async () => {
    const { data, error } = await asA
      .from('accounts')
      .select('id')
      .eq('id', bAccountId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot update or delete another user's account", async () => {
    const updated = await asA
      .from('accounts')
      .update({ name: 'pwned' })
      .eq('id', bAccountId)
      .select();
    const deleted = await asA
      .from('accounts')
      .delete()
      .eq('id', bAccountId)
      .select();
    expect(updated.data).toEqual([]);
    expect(deleted.data).toEqual([]);
    expect((await accountById(bAccountId))?.name).toBe('B private');
  });

  it('cannot insert an account owned by another user', async () => {
    const { error } = await asA
      .from('accounts')
      .insert(account(b.id, { name: 'planted' }));
    expect(error?.code).toBe('42501');
  });

  // The API always filters, so the select policy blocks this too (the moved
  // row would be invisible to its updater); the pgTAP suite's unfiltered
  // update is what isolates the update policy's WITH CHECK.
  it('cannot hand their own account to another user', async () => {
    const mine = await insertAccount(a.id);
    const { error } = await asA
      .from('accounts')
      .update({ user_id: b.id })
      .eq('id', mine.id);
    expect(error?.code).toBe('42501');
    expect((await accountById(mine.id))?.user_id).toBe(a.id);
  });

  it('gives the anon role no rows and no writes', async () => {
    const anon = createClient<Database>(LOCAL_API_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const read = await anon.from('accounts').select('id');
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    const write = await anon.from('accounts').insert(account(a.id));
    expect(write.error?.code).toBe('42501');
  });
});
