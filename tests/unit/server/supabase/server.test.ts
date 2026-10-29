import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FAKE_ANON,
  FAKE_SERVICE,
  LOCAL_URL,
  appReads,
  recordEnvReads,
} from '@/tests/unit/server/supabase/env-access';

/** A minimal stand-in for the store `next/headers` cookies() resolves to. */
const store = {
  getAll: vi.fn(() => [] as { name: string; value: string }[]),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(store),
}));

describe('lib/server/supabase/server', () => {
  beforeEach(() => {
    vi.resetModules();
    store.getAll.mockClear();
    store.set.mockReset();
  });

  it('imports without reading env vars at module scope', async () => {
    const env = recordEnvReads({});
    try {
      await import('@/lib/server/supabase/server');
      expect(appReads(env.reads)).toEqual([]);
    } finally {
      env.restore();
    }
  });

  it('uses the anon key, never the service-role key', async () => {
    const env = recordEnvReads({
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
    });
    try {
      const { createServerSupabaseClient } =
        await import('@/lib/server/supabase/server');
      await createServerSupabaseClient();
      expect(env.reads).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    } finally {
      env.restore();
    }
  });

  it('throws naming the variable when the URL is absent', async () => {
    const env = recordEnvReads({ NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON });
    try {
      const { createServerSupabaseClient } =
        await import('@/lib/server/supabase/server');
      await expect(createServerSupabaseClient()).rejects.toThrow(
        /NEXT_PUBLIC_SUPABASE_URL/,
      );
    } finally {
      env.restore();
    }
  });

  it('tolerates a read-only cookie store (Server Component render)', async () => {
    // Next throws when a Server Component sets a cookie. Session refresh then
    // has to happen elsewhere, but reading must not crash the render.
    store.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action');
    });
    const env = recordEnvReads({
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
    });
    try {
      const { createServerSupabaseClient } =
        await import('@/lib/server/supabase/server');
      const client = await createServerSupabaseClient();
      // signOut with no session clears auth cookies -> exercises setAll.
      await expect(client.auth.signOut()).resolves.toBeDefined();
    } finally {
      env.restore();
    }
  });
});
