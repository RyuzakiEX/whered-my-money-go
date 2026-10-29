import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FAKE_ANON,
  FAKE_SERVICE,
  LOCAL_URL,
  appReads,
  recordEnvReads,
} from '@/tests/unit/server/supabase/env-access';

describe('lib/server/supabase/browser', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('imports without reading env vars at module scope', async () => {
    const env = recordEnvReads({});
    try {
      await import('@/lib/server/supabase/browser');
      expect(appReads(env.reads)).toEqual([]);
    } finally {
      env.restore();
    }
  });

  it('reads only NEXT_PUBLIC_ variables, never the service-role key', async () => {
    const env = recordEnvReads({
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
      // Present on purpose: the factory must not touch it even when it exists.
      SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
    });
    try {
      const { createBrowserSupabaseClient } =
        await import('@/lib/server/supabase/browser');
      createBrowserSupabaseClient();

      const factoryReads = appReads(env.reads);
      expect(factoryReads).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(factoryReads).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
      expect(factoryReads).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    } finally {
      env.restore();
    }
  });

  it('throws naming the variable when the anon key is absent', async () => {
    const env = recordEnvReads({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL });
    try {
      const { createBrowserSupabaseClient } =
        await import('@/lib/server/supabase/browser');
      expect(() => createBrowserSupabaseClient()).toThrow(
        /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
      );
    } finally {
      env.restore();
    }
  });
});
