// Where the password-recovery email's link lands (M1-F03).
//
// The link carries a token hash (supabase/templates/recovery.html), verified
// here with verifyOtp. Unlike a PKCE code exchange, this needs nothing
// stored in the browser that asked for the reset — so a link
// requested on a laptop works when opened on a phone (code review of #55).
// A missing, expired, or used token returns to /reset-password with a plain
// explanation, never an error dump.

import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { logger, newRequestId } from '@/lib/server/logger';
import { createServerSupabaseClient } from '@/lib/server/supabase/server';
import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from '@/lib/utils/routes';

/** The one link type this route handles today. */
const ACCEPTED_TYPES: ReadonlySet<EmailOtpType> = new Set(['recovery']);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next')) ?? DEFAULT_SIGNED_IN_PATH;
  const linkFailed = new URL('/reset-password?link=expired', request.url);

  // Two link kinds. This app's recovery template sends a token hash, which
  // works on any device. Supabase's DEFAULT template sends a PKCE `code`,
  // which works only in the browser that asked — and free-tier projects on
  // the built-in mailer cannot change the template, so the preview project
  // still sends that one.
  const supabase = await createServerSupabaseClient();
  let error: { code?: string | undefined } | null;
  if (tokenHash && type && ACCEPTED_TYPES.has(type)) {
    ({ error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    return NextResponse.redirect(linkFailed);
  }
  if (error) {
    logger.warn('auth.confirm_failed', {
      requestId: newRequestId(),
      route: '/auth/confirm',
      outcome: 'failure',
      errorCode: error.code ?? 'unknown',
    });
    return NextResponse.redirect(linkFailed);
  }

  // Same-origin by construction: `next` passed safeNextPath.
  return NextResponse.redirect(new URL(next, request.url));
}
