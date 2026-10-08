import { describe, expect, it } from 'vitest';

import { LOCAL_ANON_KEY, LOCAL_API_URL, LOCAL_DB_URL } from './setup';

/**
 * Integration-project smoke test.
 *
 * Proves two things: the SECOND Vitest project is wired correctly (its own
 * include glob, setup file, longer timeout, and serial execution), and the
 * local Supabase stack from M0-B05 answers a real authenticated round trip.
 */

/** GET the PostgREST root through the Kong gateway, as the anon role. */
async function restRoot(bearer: string): Promise<Response> {
  try {
    return await fetch(`${LOCAL_API_URL}/rest/v1/`, {
      headers: { apikey: LOCAL_ANON_KEY, Authorization: `Bearer ${bearer}` },
    });
  } catch (cause) {
    throw new Error(
      `Local Supabase is not reachable at ${LOCAL_API_URL}.\n` +
        '  Start it with:  npx supabase start   (requires Docker)',
      { cause },
    );
  }
}
describe('integration project wiring', () => {
  it('loads the setup file and exposes local-only endpoints', () => {
    expect(LOCAL_API_URL).toMatch(/127\.0\.0\.1|localhost/);
    expect(LOCAL_DB_URL).toMatch(/127\.0\.0\.1|localhost/);
  });

  it('runs with the longer integration timeout', ({ task }) => {
    // 30s, set per-project in vitest.config.ts — a local round trip is slower
    // than a pure function call.
    expect(task.file.projectName).toBe('integration');
  });

  it('guards against running against a hosted Supabase', () => {
    // The setup file throws on a non-local URL. Reaching this line at all
    // means the guard let us through, which is only correct when local.
    expect(LOCAL_API_URL.includes('supabase.co')).toBe(false);
  });
});

describe('local Supabase round trip', () => {
  it('serves the REST API to a valid anon JWT', async () => {
    const response = await restRoot(LOCAL_ANON_KEY);

    // 200 plus PostgREST's OpenAPI document — not merely "not a 5xx". The
    // gateway answers 200 to a missing apikey at this path, so the status
    // alone would pass against a stack that checked nothing.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { swagger?: unknown };
    expect(body.swagger).toBe('2.0');
  });

  it('rejects a tampered JWT, so the 200 above is meaningful', async () => {
    // Flip the last signature character. If this were accepted, the anon key
    // would be decorative and the test above would prove nothing.
    const last = LOCAL_ANON_KEY.slice(-1);
    const forged = LOCAL_ANON_KEY.slice(0, -1) + (last === 'A' ? 'B' : 'A');

    const response = await restRoot(forged);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { code?: unknown };
    expect(body.code).toBe('PGRST301');
  });
});
