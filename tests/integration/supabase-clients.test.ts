import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end proof that the request-scoped client carries the user's JWT.
 *
 * A unit test can only show the factory was called with a cookie adapter. This
 * shows the adapter actually works against the local stack: a session written
 * to cookies by one client is read back — and accepted by GoTrue — by a second
 * client built from those same cookies. That is the mechanism RLS relies on.
 */

/** In-memory replacement for the store next/headers cookies() returns. */
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

const { createAdminClient } = await import('@/lib/server/supabase/admin');
const { createServerSupabaseClient } =
  await import('@/lib/server/supabase/server');

const email = `m0-b06-${randomUUID()}@example.test`;
const password = `pw-${randomUUID()}`;
let userId = '';

beforeAll(async () => {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
});

afterAll(async () => {
  if (userId !== '') await createAdminClient().auth.admin.deleteUser(userId);
});

describe('server client cookie round trip', () => {
  it('a signed-in session survives into a fresh client via cookies', async () => {
    const first = await createServerSupabaseClient();
    const signIn = await first.auth.signInWithPassword({ email, password });
    expect(signIn.error).toBeNull();
    expect(jar.size).toBeGreaterThan(0);

    const second = await createServerSupabaseClient();
    const { data, error } = await second.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBe(userId);
  });

  it('a tampered cookie is rejected, not trusted', async () => {
    // Negative case: without this, the test above would also pass against a
    // client that decoded the cookie locally without asking the server.
    for (const [name, value] of jar) jar.set(name, `${value}tampered`);

    const client = await createServerSupabaseClient();
    const { data } = await client.auth.getUser();
    expect(data.user).toBeNull();
  });
});
