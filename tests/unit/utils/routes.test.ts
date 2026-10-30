import { describe, expect, it } from 'vitest';

import { NAV_ITEMS } from '@/components/shell/nav-items';
import {
  isProtectedPath,
  isSignedOutOnlyPath,
  safeNextPath,
} from '@/lib/utils/routes';

/**
 * M1-B06: which paths need a session, which are for signed-out visitors, and
 * which `next` values are safe to redirect to.
 */

describe('isProtectedPath', () => {
  it('protects every page in the app navigation', () => {
    // Drift guard: a new nav item must not ship reachable without a session.
    for (const { href } of NAV_ITEMS) {
      expect(isProtectedPath(href), href).toBe(true);
    }
  });

  it.each(['/dashboard', '/dashboard/', '/settings/profile', '/goals/123'])(
    'protects %s',
    (path) => {
      expect(isProtectedPath(path)).toBe(true);
    },
  );

  it.each([
    '/',
    '/login',
    '/signup',
    '/reset-password',
    '/auth/callback',
    '/dashboards',
    '/settingsx',
  ])('leaves %s public', (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });
});

describe('isSignedOutOnlyPath', () => {
  it.each(['/login', '/signup', '/reset-password', '/login/'])(
    '%s is for signed-out visitors',
    (path) => {
      expect(isSignedOutOnlyPath(path)).toBe(true);
    },
  );

  it.each(['/reset-password/update', '/auth/callback', '/', '/dashboard'])(
    '%s is not — a recovery session must reach /reset-password/update',
    (path) => {
      expect(isSignedOutOnlyPath(path)).toBe(false);
    },
  );
});

describe('safeNextPath', () => {
  it.each([
    ['/goals', '/goals'],
    ['/transactions?month=2026-09', '/transactions?month=2026-09'],
    ['/settings/profile#name', '/settings/profile#name'],
  ])('keeps the same-origin path %j', (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });

  it.each<[next: string | null, why: string]>([
    ['https://evil.example/phish', 'absolute URL to another origin'],
    ['//evil.example', 'protocol-relative URL'],
    ['/\\evil.example', 'backslash, which browsers read as //'],
    ['\\\\evil.example', 'leading backslashes'],
    ['javascript:alert(1)', 'script URL'],
    ['dashboard', 'relative path'],
    ['/%2F%2Fevil.example', 'encoded double slash, decoded by some stacks'],
    // Parser differentials: each passes a raw-string check, then URL
    // normalisation collapses it to `//evil.example`. Found by security
    // review in M1-B06 — all three were accepted before the fix.
    ['/.//evil.example', 'dot segment collapsing to //'],
    ['/%2e//evil.example', 'encoded dot segment'],
    ['/a/..//evil.example', 'parent segment collapsing to //'],
    ['/login', 'back to login would loop'],
    ['/signup', 'a signed-out-only page'],
    ['', 'empty'],
    [null, 'absent'],
  ])('rejects %j (%s)', (next) => {
    expect(safeNextPath(next)).toBeNull();
  });
});
