// Ends the current session and goes to /login (M1-F04).
//
// For a session the app cannot use — a valid token with no profile row. The
// layout sends such a visitor here; redirecting straight to /login would
// loop, because the proxy sends a signed-in visitor back to the app.
//
// A GET, because it is reached by a redirect. The worst a cross-site request
// can do is sign someone out, which is harmless; the user-facing Log out stays
// a POST (the account menu's form).

import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/server/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url));
}
