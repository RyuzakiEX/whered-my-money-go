import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FAKE_SERVICE,
  LOCAL_URL,
  appReads,
  recordEnvReads,
} from '@/tests/unit/server/supabase/env-access';

/**
 * admin.ts carries the service_role key, which bypasses ALL row level
 * security. These tests pin the runtime control from
 * docs/architecture/source-structure.md#the-admints-restriction: the module
 * refuses to load in a browser, and refuses to build a client without its key.
 */
describe('lib/server/supabase/admin', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws on import when a browser bundle is detected', async () => {
    vi.stubGlobal('window', {});

    const load = import('@/lib/server/supabase/admin');

    await expect(load).rejects.toThrow(/lib\/server\/supabase\/admin\.ts/);
    await expect(load).rejects.toThrow(/source-structure\.md/);
  });

  it('imports without reading env vars at module scope', async () => {
    const env = recordEnvReads({});
    try {
      await import('@/lib/server/supabase/admin');
      expect(appReads(env.reads)).toEqual([]);
    } finally {
      env.restore();
    }
  });

  it('throws when the service-role key is absent', async () => {
    const env = recordEnvReads({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL });
    try {
      const { createAdminClient } = await import('@/lib/server/supabase/admin');
      expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      env.restore();
    }
  });

  it('throws when the service-role key is blank', async () => {
    const env = recordEnvReads({
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      SUPABASE_SERVICE_ROLE_KEY: '',
    });
    try {
      const { createAdminClient } = await import('@/lib/server/supabase/admin');
      expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      env.restore();
    }
  });

  it('throws when the project URL is absent', async () => {
    const env = recordEnvReads({ SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE });
    try {
      const { createAdminClient } = await import('@/lib/server/supabase/admin');
      expect(() => createAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    } finally {
      env.restore();
    }
  });

  it('builds a client when both variables are set', async () => {
    const env = recordEnvReads({
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
    });
    try {
      const { createAdminClient } = await import('@/lib/server/supabase/admin');
      const client = createAdminClient();
      expect(typeof client.from).toBe('function');
    } finally {
      env.restore();
    }
  });
});
