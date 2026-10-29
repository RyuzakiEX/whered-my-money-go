// Client-component Supabase client.
//
// MAY BE IMPORTED BY: 'use client' modules under app/. Not components/** —
// matrix row 6 in docs/architecture/source-structure.md bars them from
// lib/server entirely, so data reaches shared components as props.
//
// Reads ONLY NEXT_PUBLIC_ variables. The anon key is public by design; row
// level security, not key secrecy, is what protects data. Each variable is
// written out literally so Next can inline it into the browser bundle.

import { createBrowserClient } from '@supabase/ssr';

import { requireEnv } from '@/lib/server/supabase/env';
import type { Database } from '@/types/database';

export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    requireEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    requireEnv(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  );
}
