/**
 * Integration-suite setup.
 *
 * These tests run against a LOCAL Supabase (`supabase start`), never a hosted
 * project — they create and destroy rows freely, and pointing them at anything
 * real would be unrecoverable.
 *
 * The guard below is why: a misconfigured SUPABASE_DB_URL is the one mistake
 * here that cannot be undone.
 */

// Vitest does not read .env files for us. Load .env.local when it exists;
// Node never overrides a variable that is already set, so CI's explicit env
// wins over any file.
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — fine in CI, and the anon-key check below says what to do.
}

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '0.0.0.0'];

const dbUrl = process.env['SUPABASE_DB_URL'] ?? '';
const apiUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';

function isLocal(url: string): boolean {
  if (url === '') return true; // unset — the local defaults below apply
  return LOCAL_HOSTS.some((host) => url.includes(host));
}

if (!isLocal(dbUrl) || !isLocal(apiUrl)) {
  throw new Error(
    'Integration tests refuse to run against a non-local Supabase.\n' +
      'These tests create and destroy rows. Start the local stack with ' +
      '`supabase start` and unset any hosted URLs.\n' +
      `  SUPABASE_DB_URL=${dbUrl || '(unset)'}\n` +
      `  NEXT_PUBLIC_SUPABASE_URL=${apiUrl || '(unset)'}`,
  );
}

export const LOCAL_API_URL = apiUrl || 'http://127.0.0.1:54321';
export const LOCAL_DB_URL =
  dbUrl || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

if (anonKey === '') {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.\n' +
      'Print the local keys with `npx supabase status -o env` and copy ANON_KEY ' +
      'into .env.local. See workflow/01-local-setup.md.',
  );
}

/** The local stack's anon JWT. Deterministic per CLI version, public by design. */
export const LOCAL_ANON_KEY = anonKey;
