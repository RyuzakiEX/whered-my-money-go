import './next-runtime';

import { randomUUID } from 'node:crypto';

import { createServerClient } from '@supabase/ssr';
import { NextRequest, type NextResponse } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminClient } from '@/lib/server/supabase/admin';
import { config, proxy } from '@/proxy';

import { LOCAL_ANON_KEY, LOCAL_API_URL } from './setup';

/**
 * M1-B06: proxy.ts against the local stack, with session cookies made by a
 * real sign-in. Asserts both redirect directions, the open-redirect guard,
 * a session that expires mid-visit, and which paths the proxy runs on at all.
 */

// In Next 16.4.2 the matcher helper is still `unstable_doesMiddlewareMatch`;
// the bundled docs already call it `unstable_doesProxyMatch`.
const { unstable_doesMiddlewareMatch } =
  await import('next/experimental/testing/server');

const ORIGIN = 'http://localhost:3000';
const admin = createAdminClient();
let userId = '';
let sessionCookies: { name: string; value: string }[] = [];

beforeAll(async () => {
  const email = `m1-b06-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;

  // Sign in through @supabase/ssr so the cookies are exactly what a browser holds.
  const jar = new Map<string, string>();
  const client = createServerClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  sessionCookies = [...jar].map(([name, value]) => ({ name, value }));
});

afterAll(async () => {
  if (userId !== '') await admin.auth.admin.deleteUser(userId);
});

function request(path: string, cookies = sessionCookies): NextRequest {
  const req = new NextRequest(new URL(path, ORIGIN));
  for (const { name, value } of cookies) req.cookies.set(name, value);
  return req;
}

const signedOut: { name: string; value: string }[] = [];

function redirectTarget(res: NextResponse): string | null {
  const location = res.headers.get('location');
  if (location === null) return null;
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

function passedThrough(res: NextResponse): boolean {
  return res.headers.get('x-middleware-next') === '1';
}

describe('signed out', () => {
  it('sends an app page to /login, remembering where it was going', async () => {
    const res = await proxy(request('/dashboard', signedOut));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe('/login?next=%2Fdashboard');
  });

  it('keeps the query string in next, encoded', async () => {
    const res = await proxy(request('/transactions?month=2026-09', signedOut));
    expect(redirectTarget(res)).toBe(
      '/login?next=%2Ftransactions%3Fmonth%3D2026-09',
    );
  });

  it.each([
    '/',
    '/login',
    '/signup',
    '/reset-password',
    '/reset-password/update',
  ])('lets %s through', async (path) => {
    expect(passedThrough(await proxy(request(path, signedOut)))).toBe(true);
  });

  it('treats a tampered session cookie as signed out', async () => {
    const tampered = sessionCookies.map((c) => ({
      ...c,
      value: `${c.value}x`,
    }));
    const res = await proxy(request('/dashboard', tampered));
    expect(redirectTarget(res)).toBe('/login?next=%2Fdashboard');
  });
});

describe('signed in', () => {
  it.each(['/dashboard', '/settings/profile', '/', '/reset-password/update'])(
    'lets %s through',
    async (path) => {
      expect(passedThrough(await proxy(request(path)))).toBe(true);
    },
  );

  it.each(['/login', '/signup', '/reset-password'])(
    'sends %s on to the dashboard',
    async (path) => {
      const res = await proxy(request(path));
      expect(res.status).toBe(307);
      expect(redirectTarget(res)).toBe('/dashboard');
    },
  );

  it('honours a same-origin next', async () => {
    const res = await proxy(request('/login?next=%2Fgoals'));
    expect(redirectTarget(res)).toBe('/goals');
  });

  it.each(['https://evil.example/phish', '//evil.example', '/\\evil.example'])(
    'refuses an off-site next %j: no open redirect',
    async (next) => {
      const res = await proxy(
        request(`/login?next=${encodeURIComponent(next)}`),
      );
      expect(redirectTarget(res)).toBe('/dashboard');
      expect(new URL(res.headers.get('location') ?? '').origin).toBe(ORIGIN);
    },
  );
});

describe('a session that expires mid-visit', () => {
  it('is refreshed, not logged out, and the new cookies are sent back', async () => {
    const expired = withExpiredAccessToken(sessionCookies);
    const res = await proxy(request('/dashboard', expired));

    expect(passedThrough(res)).toBe(true); // no bounce to /login
    const rotated = res.cookies
      .getAll()
      .filter((c) => c.name.includes('auth-token'));
    expect(rotated.length).toBeGreaterThan(0);
    const before = expired.map((c) => c.value).join('');
    expect(rotated.map((c) => c.value).join('')).not.toBe(before);
  });
});

describe('matcher', () => {
  it.each([
    ['/dashboard', true],
    ['/', true],
    ['/login', true],
    ['/_next/static/chunks/main.js', false],
    ['/_next/image?url=x', false],
    ['/icon.svg', false],
    ['/apple-icon.png', false],
    ['/favicon.ico', false],
  ])('%s -> runs: %s', (url, runs) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(runs);
  });
});

/**
 * The same session, with its stored expiry moved into the past, so the client
 * must refresh it — the state a tab is in after sitting idle past the access
 * token's lifetime. @supabase/ssr stores the session as `base64-` + base64url
 * JSON, possibly split into `.0`, `.1` chunks.
 */
function withExpiredAccessToken(
  cookies: { name: string; value: string }[],
): { name: string; value: string }[] {
  const auth = cookies
    .filter((c) => c.name.includes('auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const first = auth[0];
  if (!first) throw new Error('no auth cookie');
  const baseName = first.name.replace(/\.\d+$/, '');
  const raw = auth.map((c) => c.value).join('');
  const json = JSON.parse(
    Buffer.from(raw.replace(/^base64-/, ''), 'base64url').toString('utf8'),
  ) as { expires_at: number };
  json.expires_at = Math.floor(Date.now() / 1000) - 60;
  const value = `base64-${Buffer.from(JSON.stringify(json)).toString('base64url')}`;
  return [
    ...cookies.filter((c) => !c.name.includes('auth-token')),
    { name: baseName, value },
  ];
}
