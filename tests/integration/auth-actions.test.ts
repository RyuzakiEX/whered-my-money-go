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

  it('changes the password for the signed-in user and lands on the dashboard', async () => {
    const user = await createUser({ confirmed: true });
    await redirectOf(() => actions.signIn({ email: user.email, password }));

    const to = await redirectOf(() =>
      actions.updatePassword({
        password: 'newpass99',
        confirmPassword: 'newpass99',
      }),
    );
    expect(to).toBe('/dashboard');

    jar.clear();
    await redirectOf(() =>
      actions.signIn({ email: user.email, password: 'newpass99' }),
    );
    expect(await sessionUserId()).toBe(user.id);
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
