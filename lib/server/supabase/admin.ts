// service_role Supabase client — BYPASSES ALL ROW LEVEL SECURITY.
//
// MAY BE IMPORTED BY: migration tooling and seed scripts (scripts/**,
// supabase/**) only. Lint enforces that allowlist; nothing reachable from app/
// may import this, including lib/server queries and actions. If a feature
// seems to need it, the RLS policy is wrong.
// See docs/architecture/source-structure.md#the-admints-restriction.

import { createClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/server/supabase/env';
import type { Database } from '@/types/database';

// Runtime control: refuse to load in a browser bundle at all. A thrown import
// breaks the page loudly instead of shipping the key's call site to a client.
if (typeof window !== 'undefined') {
  throw new Error(
    'lib/server/supabase/admin.ts was imported into a browser bundle. The ' +
      'service_role client bypasses all row level security and must never ' +
      'reach the client. See docs/architecture/source-structure.md ' +
      '("The admin.ts restriction").',
  );
}

export function createAdminClient() {
  return createClient<Database>(
    requireEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    requireEnv(
      'SUPABASE_SERVICE_ROLE_KEY',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    {
      // A service-role client has no user session to keep.
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
