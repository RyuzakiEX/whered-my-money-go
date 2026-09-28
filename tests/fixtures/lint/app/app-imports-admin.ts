// DELIBERATE VIOLATION — must fail lint. Do not "fix" this file.
// Matrix row 5: app/** must never import lib/server/supabase/admin.
//
// The admin client carries the service_role key, which bypasses ALL row level
// security. Reachable from app/, one mistake in a request handler exposes every
// user's financial data. It is allowed only in migration tooling and seed
// scripts. If a feature seems to need it here, the RLS policy is wrong.
// See docs/security/security-model.md.

import { createAdminClient } from '@/lib/server/supabase/admin';

export async function brokenGetAllTransactions() {
  const admin = createAdminClient();
  return admin.from('transactions').select('*');
}
