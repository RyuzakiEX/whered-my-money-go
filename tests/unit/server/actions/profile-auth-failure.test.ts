import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * updateProfile when Supabase Auth itself fails (code review of #53). An
 * outage must not read as "you are signed out": that sends the user to log
 * in again, for nothing, and leaves no trace on the server.
 */

const getClaims = vi.fn();
vi.mock('@/lib/server/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: { getClaims } }),
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn() }));

const { updateProfile } = await import('@/lib/server/actions/profile');

const input = { displayName: 'Ana', currency: 'PHP', timezone: 'Asia/Manila' };

beforeEach(() => {
  getClaims.mockReset();
});

describe('updateProfile when Auth fails', () => {
  it('answers unexpected, with a correlation id, and logs the failure', async () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    getClaims.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', message: 'JWKS fetch failed' },
    });

    const result = await updateProfile(input);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'unexpected', correlationId: expect.any(String) },
    });
    const lines = stderr.mock.calls.map(([line]) => String(line));
    expect(lines.some((l) => l.includes('profile.auth_failed'))).toBe(true);
    expect(lines.join('')).not.toContain('JWKS fetch failed'); // our words, not the driver's
    stderr.mockRestore();
  });

  it('still answers unauthenticated when there is simply no session', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect(await updateProfile(input)).toEqual({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
  });
});
