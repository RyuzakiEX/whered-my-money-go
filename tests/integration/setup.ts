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

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '0.0.0.0'];

const dbUrl = process.env['SUPABASE_DB_URL'] ?? '';
const apiUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';

function isLocal(url: string): boolean {
  if (url === '') return true; // not configured yet — M0-B05
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

/** True once M0-B05 has initialised the local stack. */
export const supabaseConfigured = apiUrl !== '' || dbUrl !== '';
