// DELIBERATE VIOLATION — must fail lint. Do not "fix" this file.
// The admin allowlist: lib/server/** must not import lib/server/supabase/admin.
//
// Queries and actions are called from app/, so an admin import here is an
// admin import reachable from a request — exactly what the allowlist forbids,
// just one hop removed. Use the request-scoped client from server.ts and let
// row level security do its job. See docs/architecture/source-structure.md.

import { createAdminClient } from '@/lib/server/supabase/admin';

export async function brokenListAccounts() {
  return createAdminClient().from('accounts').select('*');
}
