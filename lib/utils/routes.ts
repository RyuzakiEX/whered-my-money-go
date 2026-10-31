// Route classes for authentication (M1-B06).
//
// Shared by proxy.ts (redirects) and the login form (M1-F02, which honours a
// `next` parameter). Framework-agnostic: plain strings in, plain answers out.

/**
 * Prefixes that need a session — the app's pages, mirroring
 * components/shell/nav-items.ts. A unit test fails if a nav item is missing
 * here, so a new page cannot ship reachable without a session.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/transactions',
  '/budget',
  '/goals',
  '/timeline',
  '/accounts',
  '/reports',
  '/what-if',
  '/settings',
] as const;

/**
 * Pages for signed-out visitors only. A signed-in visitor is sent on.
 * Deliberately NOT `/reset-password/update`: a password-recovery link signs
 * the user in, and that session has to reach the page that sets the password.
 */
const SIGNED_OUT_ONLY = ['/login', '/signup', '/reset-password'] as const;

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isSignedOutOnlyPath(pathname: string): boolean {
  const path = trimTrailingSlash(pathname);
  return SIGNED_OUT_ONLY.some((page) => path === page);
}

/** Where to go when there is no usable `next`. */
export const DEFAULT_SIGNED_IN_PATH = '/dashboard';

/**
 * A `next` value that is safe to redirect to, or `null`.
 *
 * Only a same-origin absolute path is accepted. Everything that a browser or
 * a URL parser could read as another origin is refused: `https://…`, `//…`,
 * backslashes (browsers treat `\` like `/`), and percent-encoded slashes.
 * Signed-out-only pages are refused too, so `next` cannot bounce a signed-in
 * user back to /login in a loop.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next?.startsWith('/')) return null;
  if (next.startsWith('//') || next.includes('\\')) return null;
  // Encoded slashes are a path trick only in the PATH; in a query value they
  // are data (`?category=food%2Fdrink`), refusing them dropped a filtered view.
  const pathOnly = next.split(/[?#]/)[0] ?? '';
  if (/%2f|%5c/i.test(pathOnly)) return null;

  // Belt and braces: resolve against a fixed origin and require it unchanged.
  const base = 'https://same-origin.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;

  // Check the NORMALISED path, not just the input: dot segments collapse, so
  // `/.//evil.example` and `/a/..//evil.example` both become `//evil.example`,
  // which a browser resolves to another host. Found by security review
  // (M1-B06); the raw-input checks above all passed for them.
  if (url.pathname.startsWith('//') || url.pathname.includes('\\')) return null;
  const result = `${url.pathname}${url.search}${url.hash}`;
  if (new URL(result, base).origin !== base) return null;

  if (isSignedOutOnlyPath(url.pathname)) return null;
  return result;
}
