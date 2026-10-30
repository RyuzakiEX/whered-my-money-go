// Profile reads (M1-F04, M1-F05).
//
// MAY BE IMPORTED BY: app/ Server Components.
//
// The user comes from the verified session; RLS scopes the read to that same
// user, so this cannot return anyone else's profile. Throws on an
// infrastructure failure — reads do not return an envelope
// (docs/architecture/api-and-data-access.md).

import type { SupportedCurrency } from '@/lib/core/money/currency';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  currency: SupportedCurrency;
  timezone: string;
}

/** The signed-in user's profile, or null when there is no session. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createServerSupabaseClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, currency, timezone')
    .eq('id', claims.sub)
    .single();
  if (error) throw new Error(`profile read failed: ${error.code}`);

  return {
    id: data.id,
    email: typeof claims.email === 'string' ? claims.email : '',
    displayName: data.display_name,
    // The profiles_currency_allowed constraint guarantees one of the four.
    currency: data.currency as SupportedCurrency,
    timezone: data.timezone,
  };
}

/** What the shell calls the user: their name, else their email's local part. */
export function displayNameOf(
  profile: Pick<Profile, 'displayName' | 'email'>,
): string {
  const local = profile.email.split('@')[0];
  return (
    profile.displayName ?? (local !== undefined && local !== '' ? local : 'You')
  );
}
