import { describe, expect, it } from 'vitest';

import { formatInstantAsDate } from '@/lib/utils/format-date';

/**
 * An instant shown as a calendar date in the USER's timezone — never the
 * server's, never UTC (docs/domain/recurrence.md: calendar dates, not
 * instants). The day can differ across zones, which is the point.
 */
describe('formatInstantAsDate', () => {
  it('uses the user timezone, not UTC', () => {
    // 17:30 UTC on 31 October is 01:30 on 1 November in Manila.
    const instant = '2026-10-31T17:30:00Z';
    expect(formatInstantAsDate(instant, 'Asia/Manila')).toBe('Nov 1, 2026');
    expect(formatInstantAsDate(instant, 'America/New_York')).toBe(
      'Oct 31, 2026',
    );
  });

  it('reads Postgres timestamptz text', () => {
    expect(
      formatInstantAsDate('2026-11-01 03:04:05.123456+00', 'Asia/Manila'),
    ).toBe('Nov 1, 2026');
  });

  it('throws on an unreadable instant rather than print "Invalid Date"', () => {
    expect(() => formatInstantAsDate('yesterday', 'Asia/Manila')).toThrow(
      RangeError,
    );
  });
});
