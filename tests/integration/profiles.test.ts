import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminClient } from '@/lib/server/supabase/admin';
import type { Database } from '@/types/database';

import { LOCAL_ANON_KEY, LOCAL_API_URL } from './setup';

/**
 * M1-B01 and M1-B02: the `profiles` table, its sign-up trigger, and its RLS.
 *
 * Users are created through the Auth admin API, so the trigger fires exactly
 * as it does for a real sign-up. Constraint checks use the admin client, which
 * bypasses RLS but not constraints. Ownership checks sign in as a real user
 * through the anon key — the same path the browser takes — because a policy is
 * only proven by the role it applies to.
 */

type Client = SupabaseClient<Database>;

const admin = createAdminClient();
const created: string[] = [];

async function createUser(metadata?: Record<string, unknown>) {
  const email = `m1-profiles-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ...(metadata ? { user_metadata: metadata } : {}),
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

async function profileOf(id: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('profile created on sign-up (M1-B01)', () => {
  it('creates a profile with PHP, Asia/Manila, and no display name', async () => {
    const user = await createUser();
    const profile = await profileOf(user.id);

    expect(profile).toMatchObject({
      id: user.id,
      currency: 'PHP',
      timezone: 'Asia/Manila',
      display_name: null,
      onboarding_completed_at: null,
    });
    expect(profile?.created_at).toBeTruthy();
    expect(profile?.updated_at).toBeTruthy();
  });

  it('takes a trimmed display name from sign-up metadata', async () => {
    const user = await createUser({ display_name: '  Juan dela Cruz  ' });
    expect((await profileOf(user.id))?.display_name).toBe('Juan dela Cruz');
  });

  it('ignores a blank or over-long metadata name instead of failing sign-up', async () => {
    // A name the check constraint would reject must not abort the auth.users
    // insert — that would make sign-up fail on a cosmetic field.
    const blank = await createUser({ display_name: '   ' });
    const long = await createUser({ display_name: 'x'.repeat(81) });
    expect((await profileOf(blank.id))?.display_name).toBeNull();
    expect((await profileOf(long.id))?.display_name).toBeNull();
  });

  it('removes the profile when the auth user is deleted', async () => {
    const user = await createUser();
    expect(await profileOf(user.id)).not.toBeNull();

    const { error } = await admin.auth.admin.deleteUser(user.id);
    expect(error).toBeNull();
    expect(await profileOf(user.id)).toBeNull();
  });
});

describe('profile constraints (M1-B01)', () => {
  let id = '';
  beforeAll(async () => {
    id = (await createUser()).id;
  });

  it.each(['PHP', 'USD', 'EUR', 'JPY'])('accepts currency %s', async (c) => {
    const { error } = await admin
      .from('profiles')
      .update({ currency: c })
      .eq('id', id);
    expect(error).toBeNull();
  });

  it.each(['GBP', 'php', 'PH', 'XXX'])('rejects currency %s', async (c) => {
    const { error } = await admin
      .from('profiles')
      .update({ currency: c })
      .eq('id', id);
    expect(error?.code).toBe('23514'); // check_violation
  });

  it.each(['', '   '])('rejects a blank timezone %j', async (tz) => {
    const { error } = await admin
      .from('profiles')
      .update({ timezone: tz })
      .eq('id', id);
    expect(error?.code).toBe('23514');
  });

  it.each(['', '   ', 'x'.repeat(81)])(
    'rejects display name %j',
    async (name) => {
      const { error } = await admin
        .from('profiles')
        .update({ display_name: name })
        .eq('id', id);
      expect(error?.code).toBe('23514');
    },
  );

  it('accepts an 80-character display name and a null one', async () => {
    for (const name of ['x'.repeat(80), null]) {
      const { error } = await admin
        .from('profiles')
        .update({ display_name: name })
        .eq('id', id);
      expect(error).toBeNull();
    }
  });
});

describe('updated_at is maintained by trigger (M1-B01)', () => {
  it('moves updated_at forward on update and leaves created_at alone', async () => {
    const user = await createUser();
    const before = await profileOf(user.id);

    // timestamptz has microsecond precision; a short wait keeps the
    // comparison strict without depending on clock resolution.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const { error } = await admin
      .from('profiles')
      .update({ display_name: 'Renamed' })
      .eq('id', user.id);
    expect(error).toBeNull();

    const after = await profileOf(user.id);
    expect(after?.created_at).toBe(before?.created_at);
    expect(Date.parse(after?.updated_at ?? '')).toBeGreaterThan(
      Date.parse(before?.updated_at ?? ''),
    );
  });

  it('overrides an updated_at supplied by the caller', async () => {
    const user = await createUser();
    const { error } = await admin
      .from('profiles')
      .update({ display_name: 'X', updated_at: '2000-01-01T00:00:00Z' })
      .eq('id', user.id);
    expect(error).toBeNull();
    const after = await profileOf(user.id);
    expect(after?.updated_at.startsWith('2000')).toBe(false);
  });
});

describe('profiles RLS (M1-B02)', () => {
  let a: Awaited<ReturnType<typeof createUser>>;
  let b: Awaited<ReturnType<typeof createUser>>;
  let asA: Client;

  beforeAll(async () => {
    a = await createUser();
    b = await createUser();
    asA = await signedIn(a);
  });

  it('lets a user read their own profile', async () => {
    const { data, error } = await asA
      .from('profiles')
      .select('id')
      .eq('id', a.id);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: a.id }]);
  });

  it("hides every other user's profile", async () => {
    const { data: other } = await asA
      .from('profiles')
      .select('id')
      .eq('id', b.id);
    expect(other).toEqual([]);

    // Unfiltered: exactly one row, however many users exist.
    const { data: all } = await asA.from('profiles').select('id');
    expect(all).toEqual([{ id: a.id }]);
  });

  it('lets a user update their own profile', async () => {
    const { data, error } = await asA
      .from('profiles')
      .update({ display_name: 'Ana' })
      .eq('id', a.id)
      .select('display_name');
    expect(error).toBeNull();
    expect(data).toEqual([{ display_name: 'Ana' }]);
  });

  it("cannot update another user's profile", async () => {
    const { data, error } = await asA
      .from('profiles')
      .update({ display_name: 'hijacked' })
      .eq('id', b.id)
      .select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]); // targeted zero rows
    expect((await profileOf(b.id))?.display_name).toBeNull();
  });

  it('cannot move their own row to a different id', async () => {
    // USING admits the row (it is A's); the NEW row is then checked twice —
    // by the update policy's WITH CHECK, and, because PostgREST adds
    // RETURNING, by the select policy. Proven in M1-B01's PR: loosening
    // either one alone leaves this green; loosening both lets the update
    // reach the database.
    const { error } = await asA
      .from('profiles')
      .update({ id: randomUUID() })
      .eq('id', a.id);
    expect(error?.code).toBe('42501'); // insufficient_privilege (RLS)
    expect(await profileOf(a.id)).not.toBeNull();
  });

  it('cannot insert a profile, not even a valid-looking one', async () => {
    const { error } = await asA.from('profiles').insert({ id: a.id });
    expect(error?.code).toBe('42501');
  });

  it('cannot delete a profile, not even their own', async () => {
    const { data, error } = await asA
      .from('profiles')
      .delete()
      .eq('id', a.id)
      .select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]); // no delete policy, so no row is visible to delete
    expect(await profileOf(a.id)).not.toBeNull();
  });

  it('the API refuses an unfiltered update or delete outright', async () => {
    // Postgres applies the select policy to UPDATE/DELETE only when the
    // statement reads columns, so an unfiltered statement meets the update
    // and delete policies alone — and the filtered tests above would pass
    // against an update policy of `using (true)`. Over the API, Supabase's
    // safe-update guard rejects such a request before RLS is consulted
    // (21000). This pins that layer: if it ever goes, this fails, rather than
    // the API path silently relying on the update policy alone. The pgTAP
    // suite (supabase/tests/rls) covers unfiltered SQL inside the database,
    // where no such guard exists.
    const update = await asA.from('profiles').update({ display_name: 'pwned' });
    const del = await asA.from('profiles').delete();
    expect(update.error?.code).toBe('21000');
    expect(del.error?.code).toBe('21000');

    const bAfter = await profileOf(b.id);
    expect(bAfter).not.toBeNull();
    expect(bAfter?.display_name).not.toBe('pwned');
  });

  it('gives the anon role no rows at all', async () => {
    const anon = createClient<Database>(LOCAL_API_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.from('profiles').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
