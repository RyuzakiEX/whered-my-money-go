import '../../integration/next-runtime';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /auth/confirm accepts both link kinds (code review of #55):
 *  - a token hash, from this app's recovery template — works on any device;
 *  - a PKCE `code`, from Supabase's DEFAULT template, which free-tier projects
 *    on the built-in mailer cannot replace (the preview project).
 */

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
vi.mock('@/lib/server/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

const { GET } = await import('@/app/auth/confirm/route');

function target(url: string) {
  return GET(new NextRequest(url)).then((res) => {
    const location = new URL(res.headers.get('location') ?? '');
    return `${location.pathname}${location.search}`;
  });
}

const BASE = 'http://localhost:3000/auth/confirm?next=/reset-password/update';

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});

describe('/auth/confirm', () => {
  it('verifies a token hash and continues to next', async () => {
    expect(await target(`${BASE}&token_hash=abc&type=recovery`)).toBe(
      '/reset-password/update',
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      token_hash: 'abc',
    });
  });

  it("exchanges the default email's code and continues to next", async () => {
    expect(await target(`${BASE}&code=xyz`)).toBe('/reset-password/update');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
  });

  it('sends a failed or missing token back to request a fresh link', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'otp_expired' } });
    expect(await target(`${BASE}&token_hash=old&type=recovery`)).toBe(
      '/reset-password?link=expired',
    );
    expect(await target(BASE)).toBe('/reset-password?link=expired');
  });

  it('refuses link types it does not handle', async () => {
    expect(await target(`${BASE}&token_hash=abc&type=signup`)).toBe(
      '/reset-password?link=expired',
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('never redirects off-site, whatever next says', async () => {
    expect(
      await target(
        'http://localhost:3000/auth/confirm?next=//evil.example&token_hash=abc&type=recovery',
      ),
    ).toBe('/dashboard');
  });
});
