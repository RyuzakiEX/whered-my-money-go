// Session refresh for proxy.ts — the fourth Supabase client factory.
//
// MAY BE IMPORTED BY: proxy.ts only. Server Components and actions use
// server.ts; this one exists because a proxy has no `cookies()` store, only
// the incoming request and the outgoing response.
//
// It does exactly one thing: read the session, refreshing it when the access
// token has expired, and write any rotated cookies onto BOTH the request
// (so this render sees them) and the response (so the browser keeps them).
// No business logic, no database queries
// (docs/architecture/system-architecture.md, the container table).

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { requireEnv } from '@/lib/server/supabase/env';
import type { Database } from '@/types/database';

export interface SessionResult {
  /** Pass-through response carrying any refreshed cookies. */
  response: NextResponse;
  /** The verified user id, or null when there is no valid session. */
  userId: string | null;
}

export async function updateSession(
  request: NextRequest,
): Promise<SessionResult> {
  const url = requireEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const anonKey = requireEnv(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims VERIFIES the JWT (and refreshes an expired one through setAll
  // above). Never trust the cookie's session unverified.
  const { data } = await supabase.auth.getClaims();
  return { response, userId: data?.claims.sub ?? null };
}

/** A redirect that keeps the refreshed session cookies from `from`. */
export function redirectWithCookies(to: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(to);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}
