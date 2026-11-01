import './next-runtime';

import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * A signed-in user whose profile row is missing (deleted user with a still-
 * valid token, or a sign-up whose trigger failed). getProfile used to throw,
 * so every app page showed an error (code review of #56). Now the layout sends
 * them to /auth/signout, which ends the session — a plain redirect to /login
 * would loop, since the proxy sends a signed-in visitor back to the app.
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

const { createAdminClient } = await import('@/lib/server/supabase/admin');
const { createServerSupabaseClient } =
  await import('@/lib/server/supabase/server');
const { getProfile } = await import('@/lib/server/queries/profile');
const { GET: signOutRoute } = await import('@/app/auth/signout/route');
const { NextRequest } = await import('next/server');

const admin = createAdminClient();
let userId = '';

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe('a session without a profile row', () => {
  it('reads as no profile, and /auth/signout ends the session', async () => {
    const email = `m1-missing-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;

    const client = await createServerSupabaseClient();
    await client.auth.signInWithPassword({ email, password });
    await admin.from('profiles').delete().eq('id', userId);

    expect(await getProfile()).toBeNull();

    const res = await signOutRoute(
      new NextRequest('http://localhost:3000/auth/signout'),
    );
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/login');
    const after = await createServerSupabaseClient();
    expect((await after.auth.getUser()).data.user).toBeNull();
  });
});
