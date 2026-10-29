// Request-scoped Supabase client — the default for all data access.
//
// MAY BE IMPORTED BY: lib/server/** (queries, actions, auth), and Server
// Components / Route Handlers under app/. Never by components/** (matrix row 6
// in docs/architecture/source-structure.md).
//
// It carries the signed-in user's JWT from the request cookies, so every query
// runs as that user and row level security applies. Create one per request;
// never cache it at module scope, or one user's session leaks into another's
// request.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { requireEnv } from '@/lib/server/supabase/env';
import type { Database } from '@/types/database';

export async function createServerSupabaseClient() {
  const url = requireEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const anonKey = requireEnv(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; Next throws. Reading still
          // works, and the session refresh that needed the write happens in
          // the request proxy (M1 auth), which can.
        }
      },
    },
  });
}
