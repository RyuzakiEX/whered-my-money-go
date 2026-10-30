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

describe('revalidateForProfileChange', () => {
  it('invalidates every tag for that user — the matrix row is all ●, plus profile', () => {
    revalidateForProfileChange('u-1');
    const invalidated = updateTag.mock.calls
      .map(([tag]) => tag as string)
      .sort();
    expect(invalidated).toEqual(
      Object.values(tags)
        .map((make) => make('u-1'))
        .sort(),
    );
  });

  it("never touches another user's tags", () => {
    revalidateForProfileChange('u-1');
    for (const [tag] of updateTag.mock.calls) {
      expect(tag).toMatch(/^user:u-1:/);
    }
  });
});
