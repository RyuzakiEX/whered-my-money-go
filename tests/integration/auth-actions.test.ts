import './next-runtime';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * M1-B05: the auth Server Actions against the local stack.
 *
 * The central property: a wrong password, an unknown email, and an
 * unconfirmed account produce BYTE-IDENTICAL results, so the login form
 * cannot be used to discover who has an account. Reset requests likewise
 * answer the same whether or not the email exists.
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

/** `redirect()` throws in Next; the mock throws something we can inspect. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { createAdminClient } = await import('@/lib/server/supabase/admin');
const { createServerSupabaseClient } =
  await import('@/lib/server/supabase/server');
const actions = await import('@/lib/server/actions/auth');

const admin = createAdminClient();
const created: string[] = [];
const password = `pw-${randomUUID()}`;

function newEmail(tag: string) {
  return `m1-b05-${tag}-${randomUUID()}@example.test`;
}

async function createUser(opts: { confirmed: boolean }) {
  const email = newEmail(opts.confirmed ? 'user' : 'unconfirmed');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: opts.confirmed,
  });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email };
}

/** Run an action that is expected to redirect; return where it went. */
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error('expected a redirect');
}

async function sessionUserId(): Promise<string | null> {
  const client = await createServerSupabaseClient();
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

const logged: string[] = [];
beforeEach(() => {
  jar.clear();
  logged.length = 0;
  vi.spyOn(console, 'log').mockImplementation((line: string) =>
    logged.push(line),
  );
  vi.spyOn(console, 'error').mockImplementation((line: string) =>
    logged.push(line),
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('signUp', () => {
  it('creates the account, starts a session, and lands on the dashboard', async () => {
    const email = newEmail('signup');
    const to = await redirectOf(() =>
      actions.signUp({ email, password: 'hunter22', displayName: 'Ana' }),
    );
    expect(to).toBe('/dashboard');

    const id = await sessionUserId();
    expect(id).not.toBeNull();
    created.push(id ?? '');

    // The sign-up trigger used the submitted name.
    const { data } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', id ?? '');
    expect(data).toEqual([{ display_name: 'Ana' }]);
  });

  it('returns field errors from the shared schema, without calling Auth', async () => {
    const result = await actions.signUp({ email: 'nope', password: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'validation') {
      expect(Object.keys(result.error.fields).sort()).toEqual([
        'email',
        'password',
      ]);
    } else {
      throw new Error(`expected validation, got ${JSON.stringify(result)}`);
    }
  });

  it('rejects unknown fields rather than passing them to Auth', async () => {
    const result = await actions.signUp({
      email: newEmail('x'),
      password: 'hunter22',
      role: 'admin',
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });
});

describe('signIn', () => {
  it('signs in and lands on the dashboard', async () => {
    const user = await createUser({ confirmed: true });
    const to = await redirectOf(() =>
      actions.signIn({ email: user.email, password }),
    );
    expect(to).toBe('/dashboard');
    expect(await sessionUserId()).toBe(user.id);
  });

  it('goes to a safe next after signing in, and never off-site', async () => {
    const user = await createUser({ confirmed: true });
    expect(
      await redirectOf(() =>
        actions.signIn({ email: user.email, password }, '/goals'),
      ),
    ).toBe('/goals');
    jar.clear();
    for (const next of [
      'https://evil.example',
      '//evil.example',
      '/.//evil.example',
    ]) {
      expect(
        await redirectOf(() =>
          actions.signIn({ email: user.email, password }, next),
        ),
      ).toBe('/dashboard');
      jar.clear();
    }
  });

  it('answers a wrong password, an unknown email, and an unconfirmed account identically', async () => {
    const user = await createUser({ confirmed: true });
    const unconfirmed = await createUser({ confirmed: false });

    const wrongPassword = await actions.signIn({
      email: user.email,
      password: 'not-it-1',
    });
    const unknownEmail = await actions.signIn({
      email: newEmail('nobody'),
      password,
    });
    const notConfirmed = await actions.signIn({
      email: unconfirmed.email,
      password,
    });

    expect(wrongPassword).toMatchObject({
      ok: false,
      error: { kind: 'auth_failed' },
    });
    // Byte-identical: no difference in kind, message, or shape.
    expect(JSON.stringify(unknownEmail)).toBe(JSON.stringify(wrongPassword));
    expect(JSON.stringify(notConfirmed)).toBe(JSON.stringify(wrongPassword));
    expect(jar.size).toBe(0); // no session was started
  });

  it('never logs the email or the password, even on failure', async () => {
    const user = await createUser({ confirmed: true });
    await actions.signIn({ email: user.email, password: 'not-it-1' });
    expect(logged.length).toBeGreaterThan(0); // the failure was logged
    for (const line of logged) {
      expect(line).not.toContain(user.email);
      expect(line).not.toContain('not-it-1');
    }
  });
});

describe('requestPasswordReset', () => {
  it('answers the same whether or not the account exists', async () => {
    const user = await createUser({ confirmed: true });
    const known = await actions.requestPasswordReset({ email: user.email });
    const unknown = await actions.requestPasswordReset({
      email: newEmail('ghost'),
    });

    expect(known).toEqual({ ok: true, data: null });
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(known));
  });

  it('actually sends the email to an existing account', async () => {
    const user = await createUser({ confirmed: true });
    await actions.requestPasswordReset({ email: user.email });

    // Mailpit catches local mail (workflow/01-local-setup.md).
    const search = await fetch(
      `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${user.email}"`)}`,
    );
    const body = (await search.json()) as { messages_count: number };
    expect(body.messages_count).toBeGreaterThan(0);
  });

  it('returns field errors for a malformed email', async () => {
    const result = await actions.requestPasswordReset({ email: 'nope' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });
});

describe('updatePassword', () => {
  it('requires a session', async () => {
    const result = await actions.updatePassword({
      password: 'newpass99',
      confirmPassword: 'newpass99',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'unauthenticated' } });
  });

  it('refuses an ordinary signed-in session: changing a password needs a recovery link', async () => {
    // A stolen session cookie or an unattended laptop must not be enough to
    // take the account over by changing its password.
    const user = await createUser({ confirmed: true });
    await redirectOf(() => actions.signIn({ email: user.email, password }));

    const result = await actions.updatePassword({
      password: 'newpass99',
      confirmPassword: 'newpass99',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'unauthenticated' } });

    // The old password still works.
    jar.clear();
    await redirectOf(() => actions.signIn({ email: user.email, password }));
    expect(await sessionUserId()).toBe(user.id);
  });

  it('changes the password from a recovery session and signs out every other session', async () => {
    const user = await createUser({ confirmed: true });

    // Another device, signed in before the reset.
    const { createClient } = await import('@supabase/supabase-js');
    const otherDevice = createClient(
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54321',
      process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const other = await otherDevice.auth.signInWithPassword({
      email: user.email,
      password,
    });
    expect(other.error).toBeNull();

    // The recovery link, as the email would carry it, verified into a session.
    const link = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: user.email,
    });
    if (link.error) throw link.error;
    const client = await createServerSupabaseClient();
    const verified = await client.auth.verifyOtp({
      type: 'recovery',
      token_hash: link.data.properties.hashed_token,
    });
    expect(verified.error).toBeNull();

    const to = await redirectOf(() =>
      actions.updatePassword({
        password: 'newpass99',
        confirmPassword: 'newpass99',
      }),
    );
    expect(to).toBe('/dashboard');

    // The other device can no longer refresh its session.
    const refreshed = await otherDevice.auth.refreshSession();
    expect(refreshed.error).not.toBeNull();

    // And the new password is the one that works.
    jar.clear();
    await redirectOf(() =>
      actions.signIn({ email: user.email, password: 'newpass99' }),
    );
    expect(await sessionUserId()).toBe(user.id);
  });

  it('follows the emailed link on a different device and changes the password', async () => {
    // The path a real user takes, from another device: the email's link
    // carries a token hash (supabase/templates/recovery.html) that
    // /auth/confirm verifies, so nothing from the requesting browser is
    // needed. The old PKCE link failed on any other device (code review of
    // #55); the cleared cookie jar below is that other device.
    const user = await createUser({ confirmed: true });
    await actions.requestPasswordReset({ email: user.email });

    let link: string | undefined;
    for (let attempt = 0; attempt < 20 && !link; attempt++) {
      const search = await fetch(
        `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${user.email}"`)}`,
      );
      const { messages } = (await search.json()) as {
        messages: { ID: string }[];
      };
      const id = messages[0]?.ID;
      if (id) {
        const message = await fetch(
          `http://127.0.0.1:54324/api/v1/message/${id}`,
        );
        const { HTML } = (await message.json()) as { HTML: string };
        link = /href="([^"]*\/auth\/confirm[^"]*)"/
          .exec(HTML)?.[1]
          ?.replaceAll('&amp;', '&');
      }
      if (!link) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!link) throw new Error('no reset email');
    expect(new URL(link).searchParams.get('type')).toBe('recovery');

    jar.clear(); // another device: no cookies from the request
    const { GET } = await import('@/app/auth/confirm/route');
    const { NextRequest } = await import('next/server');
    const confirmed = await GET(new NextRequest(link));
    expect(new URL(confirmed.headers.get('location') ?? '').pathname).toBe(
      '/reset-password/update',
    );

    const to = await redirectOf(() =>
      actions.updatePassword({
        password: 'newpass99',
        confirmPassword: 'newpass99',
      }),
    );
    expect(to).toBe('/dashboard');
  });

  it('refuses the same emailed link a second time', async () => {
    const user = await createUser({ confirmed: true });
    const link = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: user.email,
    });
    if (link.error) throw link.error;
    const url = `http://localhost:3000/auth/confirm?next=/reset-password/update&token_hash=${link.data.properties.hashed_token}&type=recovery`;
    const { GET } = await import('@/app/auth/confirm/route');
    const { NextRequest } = await import('next/server');

    const first = await GET(new NextRequest(url));
    expect(new URL(first.headers.get('location') ?? '').pathname).toBe(
      '/reset-password/update',
    );
    jar.clear();
    const second = await GET(new NextRequest(url));
    const location = new URL(second.headers.get('location') ?? '');
    expect(`${location.pathname}${location.search}`).toBe(
      '/reset-password?link=expired',
    );
  });

  it('reports a mismatched confirmation on the confirmation field', async () => {
    const result = await actions.updatePassword({
      password: 'newpass99',
      confirmPassword: 'newpass98',
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'validation',
        fields: { confirmPassword: [expect.any(String)] },
      },
    });
  });
});

describe('signOut', () => {
  it('ends the session and lands on /login', async () => {
    const user = await createUser({ confirmed: true });
    await redirectOf(() => actions.signIn({ email: user.email, password }));
    expect(await sessionUserId()).toBe(user.id);

    expect(await redirectOf(() => actions.signOut())).toBe('/login');
    expect(await sessionUserId()).toBeNull();
  });
});
