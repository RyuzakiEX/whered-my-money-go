// Route protection (M1-B06). Next.js 16's `proxy` — the convention formerly
// called `middleware`.
//
// Keeps the session fresh on every page request and applies two redirects:
//   - no session, app page        -> /login?next=<the page>
//   - a session, signed-out page  -> a safe `next`, else /dashboard
//
// This is a convenience layer, not the security boundary. Server Functions
// are POSTs to the page that uses them, so a matcher change could silently
// skip one; every action and query checks the session itself, and RLS checks
// it again in the database.

import type { NextRequest } from 'next/server';

import {
  redirectWithCookies,
  updateSession,
} from '@/lib/server/supabase/proxy';
import {
  DEFAULT_SIGNED_IN_PATH,
  isProtectedPath,
  isSignedOutOnlyPath,
  safeNextPath,
} from '@/lib/utils/routes';

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname, search, searchParams } = request.nextUrl;

  if (userId === null && isProtectedPath(pathname)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    return redirectWithCookies(login, response);
  }

  if (userId !== null && isSignedOutOnlyPath(pathname)) {
    const next = safeNextPath(searchParams.get('next'));
    const target = new URL(next ?? DEFAULT_SIGNED_IN_PATH, request.url);
    // Second, independent guard: whatever `next` became, the redirect must
    // stay on this origin. A path normalising to `//host` resolves off-site.
    const destination =
      target.origin === request.nextUrl.origin
        ? target
        : new URL(DEFAULT_SIGNED_IN_PATH, request.url);
    return redirectWithCookies(destination, response);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except build assets, image optimisation, and the named
    // public files (icons, robots, sitemap): those need no session. Each
    // exclusion is anchored (code review of #52): a bare `icon` prefix or a
    // blanket `.png` rule would also skip /iconography or a protected
    // /reports/chart.png, leaving it unprotected.
    '/((?!_next/static/|_next/image|favicon\\.ico$|(?:apple-)?icon\\d*\\.(?:svg|png|ico)$|robots\\.txt$|sitemap\\.xml$).*)',
  ],
};
