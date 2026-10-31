import '../../../integration/next-runtime';

import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The proxy's session helper, with @supabase/ssr faked: the fake calls
 * setAll exactly as the library does when it rotates a session — cookies
 * plus no-cache headers. Code review of #52: those headers were dropped, so
 * a response carrying a fresh session could be cached and served to someone
 * else.
 */

const NO_CACHE = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
};

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: { name: string; value: string; options: object }[],
          headers: Record<string, string>,
        ) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: () => {
        options.cookies.setAll(
          [{ name: 'sb-test-auth-token', value: 'rotated', options: {} }],
          NO_CACHE,
        );
        return Promise.resolve({ data: { claims: { sub: 'u-1' } } });
      },
    },
  }),
}));

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');

const { updateSession, redirectWithCookies } =
  await import('@/lib/server/supabase/proxy');

describe('updateSession', () => {
  it('passes the rotated cookies AND the no-cache headers to the response', async () => {
    const { response, userId } = await updateSession(
      new NextRequest('http://localhost:3000/dashboard'),
    );
    expect(userId).toBe('u-1');
    expect(response.cookies.get('sb-test-auth-token')?.value).toBe('rotated');
    expect(response.headers.get('cache-control')).toBe(
      NO_CACHE['Cache-Control'],
    );
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('keeps those headers on a redirect built from that response', async () => {
    const { response } = await updateSession(
      new NextRequest('http://localhost:3000/login'),
    );
    const redirect = redirectWithCookies(
      new URL('http://localhost:3000/dashboard'),
      response,
    );
    expect(redirect.cookies.get('sb-test-auth-token')?.value).toBe('rotated');
    expect(redirect.headers.get('cache-control')).toBe(
      NO_CACHE['Cache-Control'],
    );
  });
});
