import { describe, expect, it } from 'vitest';

import { missingPublicEnv, REQUIRED_PUBLIC_ENV } from '@/lib/utils/build-env';

/**
 * The build guard (next.config.ts). Production once deployed "successfully"
 * without the Supabase variables and then 500'd on every page: proxy.ts needs
 * them on every request, and NEXT_PUBLIC_* values are baked in at build time.
 */

const complete = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
};

describe('missingPublicEnv', () => {
  it('names nothing when every required variable is set', () => {
    expect(missingPublicEnv(complete)).toEqual([]);
  });

  it('names each missing or blank variable', () => {
    expect(missingPublicEnv({})).toEqual([...REQUIRED_PUBLIC_ENV]);
    expect(
      missingPublicEnv({ ...complete, NEXT_PUBLIC_SUPABASE_ANON_KEY: '  ' }),
    ).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  });
});
