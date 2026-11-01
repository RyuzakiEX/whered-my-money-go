// Dates for display.
//
// An instant (a timestamptz such as accounts.created_at) is shown as the
// calendar date it was in the USER's timezone — the profile's — never the
// server's and never UTC: 17:30 UTC on 31 October is 1 November in Manila
// (docs/domain/recurrence.md). Display only; nothing here feeds date math.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string, locale: string): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeZone,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * `Nov 1, 2026` from an ISO instant, or from Postgres's text form
 * (`2026-11-01 03:04:05.123456+00`). Throws RangeError on anything
 * unreadable, rather than render "Invalid Date" on someone's account.
 */
export function formatInstantAsDate(
  instant: string,
  timeZone: string,
  locale = 'en-PH',
): string {
  const iso = instant.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`not an instant: ${instant}`);
  }
  return formatterFor(timeZone, locale).format(date);
}
