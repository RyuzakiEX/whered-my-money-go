import { randomUUID } from 'node:crypto';

import type { BrowserContext } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';

/**
 * Sign a fresh user in for an E2E test, without going through the UI.
 *
 * App pages need a session since M1-B06. Each test gets its OWN user — never
 * a shared fixture account — so tests can run in parallel and repeat. The
 * session is created with @supabase/ssr, so the browser receives exactly the
 * cookies the app itself would set. Email confirmation is off on the local
 * and CI stacks, so sign-up returns a session directly.
 */

// The test process does not load .env.local the way `next dev` does. In CI
// the job exports these variables, and an existing variable always wins.
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — fine in CI.
}

export async function signInAsNewUser(
  context: BrowserContext,
  baseURL: string,
): Promise<{ email: string; password: string }> {
  const url =
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';
  if (anonKey === '') {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. See workflow/01-local-setup.md.',
    );
  }

  const jar = new Map<string, string>();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });

  const email = `e2e-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const { error } = await supabase.auth.signUp({ email, password });
  if (error)
    throw new Error(`E2E sign-up failed: ${error.code ?? error.message}`);

  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, url: baseURL })),
  );
  return { email, password };
}
