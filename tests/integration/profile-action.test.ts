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

/**
 * M1-B07: updateProfile against the local stack. The row it updates comes
 * from the SESSION, never from input — proven by a user submitting another
 * user's id and that row coming out untouched.
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
const { updateProfile } = await import('@/lib/server/actions/profile');
const { tags } = await import('@/lib/server/cache/tags');

const admin = createAdminClient();
const password = `pw-${randomUUID()}`;
const users: { id: string; email: string }[] = [];

async function createUser() {
  const email = `m1-b07-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push({ id: data.user.id, email });
  return { id: data.user.id, email };
}

async function signInAs(email: string) {
  jar.clear();
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function profileOf(id: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('display_name, currency, timezone')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

const update = {
  displayName: 'Ana',
  currency: 'USD',
  timezone: 'America/New_York',
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
  for (const { id } of users) await admin.auth.admin.deleteUser(id);
});

describe('updateProfile', () => {
  it("updates the signed-in user's own profile and returns it", async () => {
    const result = await updateProfile(update);
    expect(result).toEqual({ ok: true, data: update });
    expect(await profileOf(a.id)).toEqual({
      display_name: 'Ana',
      currency: 'USD',
      timezone: 'America/New_York',
    });
  });

  it("invalidates every cache tag, for the session's user only", async () => {
    await updateProfile(update);
    const invalidated = updateTag.mock.calls.map(([tag]) => tag as string);
    expect(invalidated).toContain(tags.profile(a.id));
    expect(invalidated).toHaveLength(Object.keys(tags).length);
    for (const tag of invalidated)
      expect(tag).toMatch(new RegExp(`^user:${a.id}:`));
  });

  it('stores a zone in canonical spelling and clears a blank name', async () => {
    const result = await updateProfile({
      ...update,
      displayName: '  ',
      timezone: 'asia/manila',
    });
    expect(result).toEqual({
      ok: true,
      data: { displayName: null, currency: 'USD', timezone: 'Asia/Manila' },
    });
    expect(await profileOf(a.id)).toMatchObject({
      display_name: null,
      timezone: 'Asia/Manila',
    });
  });

  it("refuses another user's id in the input and touches no row", async () => {
    const bBefore = await profileOf(b.id);
    const aBefore = await profileOf(a.id);

    for (const key of ['id', 'user_id', 'userId']) {
      const result = await updateProfile({
        ...update,
        displayName: 'hijacked',
        [key]: b.id,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'validation' },
      });
    }

    expect(await profileOf(b.id)).toEqual(bBefore);
    expect(await profileOf(a.id)).toEqual(aBefore);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('rejects a currency outside the allowlist, on the currency field', async () => {
    const before = await profileOf(a.id);
    const result = await updateProfile({ ...update, currency: 'GBP' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', fields: { currency: [expect.any(String)] } },
    });
    expect(await profileOf(a.id)).toEqual(before);
  });

  it.each(['Not/AZone', '+08:00'])(
    'rejects timezone %j, on the timezone field',
    async (timezone) => {
      const before = await profileOf(a.id);
      const result = await updateProfile({ ...update, timezone });
      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'validation',
          fields: { timezone: [expect.any(String)] },
        },
      });
      expect(await profileOf(a.id)).toEqual(before);
    },
  );

  it('requires a session', async () => {
    jar.clear();
    const result = await updateProfile(update);
    expect(result).toEqual({ ok: false, error: { kind: 'unauthenticated' } });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
