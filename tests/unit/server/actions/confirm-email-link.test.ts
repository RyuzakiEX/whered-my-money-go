import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * confirmEmailLink, the Continue button behind /auth/confirm (M1-F03). It
 * accepts both link kinds — a token hash (this app's template, any device)
 * and a PKCE code (Supabase's default email, same browser only) — and sends
 * any failure back to request a fresh link.
 */

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
vi.mock('@/lib/server/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { confirmEmailLink } = await import('@/lib/server/actions/auth');

async function target(input: unknown): Promise<string> {
  try {
    await confirmEmailLink(input);
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error('expected a redirect');
}

const NEXT = { next: '/reset-password/update' };

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('confirmEmailLink', () => {
  it('verifies a token hash and continues to next', async () => {
    expect(await target({ ...NEXT, tokenHash: 'abc', type: 'recovery' })).toBe(
      '/reset-password/update',
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      token_hash: 'abc',
    });
  });

  it("exchanges the default email's code and continues to next", async () => {
    expect(await target({ ...NEXT, code: 'xyz' })).toBe(
      '/reset-password/update',
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
  });

  it('sends a failed or missing token back to request a fresh link', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'otp_expired' } });
    expect(await target({ ...NEXT, tokenHash: 'old', type: 'recovery' })).toBe(
      '/reset-password?link=expired',
    );
    expect(await target(NEXT)).toBe('/reset-password?link=expired');
  });

  it('refuses link types it does not handle, and unknown fields', async () => {
    expect(await target({ ...NEXT, tokenHash: 'abc', type: 'signup' })).toBe(
      '/reset-password?link=expired',
    );
    expect(await target({ ...NEXT, code: 'x', userId: 'someone' })).toBe(
      '/reset-password?link=expired',
    );
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('never redirects off-site, whatever next says', async () => {
    expect(
      await target({
        next: '//evil.example',
        tokenHash: 'abc',
        type: 'recovery',
      }),
    ).toBe('/dashboard');
  });
});
