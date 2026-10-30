// Where Supabase Auth email links land (M1-F03): the password-recovery link
// today, email confirmation later.
//
// The link carries a one-time `code`. Exchanging it — together with the PKCE
// verifier cookie that was set when the reset was requested — signs the user
// in, then we continue to `next`. A missing, expired, or already-used code
// sends the user back to request a fresh link, never to an error dump.

import { NextResponse, type NextRequest } from 'next/server';

import { logger, newRequestId } from '@/lib/server/logger';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';
import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from '@/lib/utils/routes';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next')) ?? DEFAULT_SIGNED_IN_PATH;
  const linkFailed = new URL('/reset-password?link=expired', request.url);

  if (!code) return NextResponse.redirect(linkFailed);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logger.warn('auth.callback_failed', {
      requestId: newRequestId(),
      route: '/auth/callback',
      outcome: 'failure',
      errorCode: error.code ?? 'unknown',
    });
    return NextResponse.redirect(linkFailed);
  }

  // Same-origin by construction: `next` passed safeNextPath.
  return NextResponse.redirect(new URL(next, request.url));
}
