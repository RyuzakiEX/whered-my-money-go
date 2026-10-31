import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateTag = vi.fn();
vi.mock('next/cache', () => ({ updateTag }));

const { revalidateForProfileChange } =
  await import('@/lib/server/cache/revalidate');
const { tags } = await import('@/lib/server/cache/tags');

/**
 * The invalidation matrix in docs/architecture/state-and-caching.md is the
 * specification; this test is its executable form. A helper that misses a
 * tag means a user changes something and watches a figure not move.
 */

beforeEach(() => {
  updateTag.mockClear();
});

describe('tags', () => {
  it('namespaces every tag by user, so users cannot touch each other', () => {
    for (const make of Object.values(tags)) {
      expect(make('u-1')).toMatch(/^user:u-1:/);
      expect(make('u-1')).not.toBe(make('u-2'));
    }
  });
});

/**
 * The "Update profile" row of the matrix in
 * docs/architecture/state-and-caching.md, written out — plus `profile`
 * itself (M1-B07). Comparing against "every tag that exists" would be
 * circular: it passes whatever the helper does (code review of #53).
 */
const PROFILE_CHANGE_ROW = [
  'accounts',
  'transactions',
  'categories',
  'budgets',
  'goals',
  'recurring',
  'dashboard',
  'sts',
  'timeline',
  'profile',
] as const;

describe('revalidateForProfileChange', () => {
  it('invalidates exactly the documented row, for that user', () => {
    revalidateForProfileChange('u-1');
    const invalidated = updateTag.mock.calls
      .map(([tag]) => tag as string)
      .sort();
    expect(invalidated).toEqual(
      PROFILE_CHANGE_ROW.map((name) => tags[name]('u-1')).sort(),
    );
  });

  it("never touches another user's tags", () => {
    revalidateForProfileChange('u-1');
    for (const [tag] of updateTag.mock.calls) {
      expect(tag).toMatch(/^user:u-1:/);
    }
  });
});
