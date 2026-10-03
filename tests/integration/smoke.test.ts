import { describe, expect, it } from 'vitest';

import { LOCAL_API_URL, LOCAL_DB_URL, supabaseConfigured } from './setup';

/**
 * Integration-project smoke test.
 *
 * This proves the SECOND Vitest project is wired correctly — its own include
 * glob, setup file, longer timeout, and serial execution. It deliberately does
 * NOT connect to Supabase: the local stack lands in M0-B05, and a test that
 * requires it would fail for everyone until then.
 *
 * M0-B05 replaces the skipped test below with a real connection assertion.
 * Its acceptance criteria carry that handoff.
 */
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

  it.skipIf(!supabaseConfigured)(
    'connects to the local Supabase REST endpoint',
    async () => {
      // Activated by M0-B05, when supabase/config.toml exists.
      const response = await fetch(`${LOCAL_API_URL}/rest/v1/`, {
        headers: { apikey: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '' },
      });
      expect(response.status).toBeLessThan(500);
    },
  );
});
