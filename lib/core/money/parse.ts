/**
 * Money parsing and formatting.
 *
 * Implements the algorithm in docs/domain/money-and-rounding.md. The doc is
 * the specification; read it before changing anything here.
 *
 * All money is an integer count of minor units — `₱1,234.56` is `123456`.
 * Floats are never used, because the error compounds across a transaction
 * history and a drifting balance is the bug this app cannot ship.
 * See docs/adr/0005-money-as-integer-minor-units.md.
 */

import {
  CURRENCY_MARKERS,
  currencyExponent,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
  UNSUPPORTED_MARKERS,
  type SupportedCurrency,
} from './currency';

/** An integer count of a currency's minor unit (centavos for PHP). */
export type Minor = number;

export type ParseMoneyError =
  | 'empty'
  | 'not_a_number'
  | 'too_many_decimals'
  | 'ambiguous_separators'
  | 'foreign_currency'
  | 'out_of_range';

export type ParseMoneyResult =
  { ok: true; minor: Minor } | { ok: false; reason: ParseMoneyError };

/**
 * Every marker that is foreign to `currency`: the other supported currencies'
 * markers plus every unsupported one. An unrecognised symbol is an error, not
 * something to strip — silently treating `$10` as ₱10 is the kind of mistake
 * that is invisible until it has corrupted a balance.
 */
function foreignMarkers(currency: SupportedCurrency): readonly string[] {
  const others = SUPPORTED_CURRENCIES.filter((c) => c !== currency).flatMap(
    (c) => CURRENCY_MARKERS[c],
  );
  return [...others, ...UNSUPPORTED_MARKERS];
}

/** Character positions covered by an occurrence of any of `markers`. */
function coveredPositions(
  text: string,
  markers: readonly string[],
): Set<number> {
  const covered = new Set<number>();
  // Longest first, so `US$` claims its `$` before a bare `$` would.
  const longestFirst = [...markers].sort((a, b) => b.length - a.length);
  for (const marker of longestFirst) {
    for (
      let at = text.indexOf(marker);
      at !== -1;
      at = text.indexOf(marker, at + 1)
    ) {
      for (let i = at; i < at + marker.length; i++) covered.add(i);
    }
  }
  return covered;
}

/** Unicode spaces used as grouping separators. */
const SPACE_SEPARATORS = /[     \s]/g;

function fail(reason: ParseMoneyError): ParseMoneyResult {
  return { ok: false, reason };
}

/**
 * Parses user-entered text into integer minor units.
 *
 * Called at the input boundary (lib/validation), never inside lib/core's
 * calculations — those only ever see integers.
 */
export function parseMoneyToMinor(
  input: string,
  currency: string,
): ParseMoneyResult {
  if (!isSupportedCurrency(currency)) return fail('foreign_currency');
  const exponent = currencyExponent(currency);

  // Step 1 — trim and normalise Unicode spaces away. Uppercase so `php 10`
  // matches the `PHP` marker; only digits and separators survive step 2, so
  // case never matters past here.
  let text = input.replace(SPACE_SEPARATORS, '').toUpperCase();
  if (text.length === 0) return fail('empty');

  // Step 2 — reject a marker belonging to another currency before stripping
  // our own, so "$1,234.50" is an error for PHP rather than ₱1,234.50.
  // A foreign marker inside one of our own does not count: the `S$` within a
  // USD user's `US$5` is part of `US$`, while a bare `S$10` is Singapore's.
  const own = CURRENCY_MARKERS[currency];
  const ours = coveredPositions(text, own);
  for (const marker of foreignMarkers(currency)) {
    for (
      let at = text.indexOf(marker);
      at !== -1;
      at = text.indexOf(marker, at + 1)
    ) {
      let inside = true;
      for (let i = at; i < at + marker.length; i++) {
        if (!ours.has(i)) inside = false;
      }
      if (!inside) return fail('foreign_currency');
    }
  }
  text = text
    .split('')
    .filter((_, i) => !ours.has(i))
    .join('');
  if (text.length === 0) return fail('empty');

  // Step 3 — accounting negation: a fully parenthesised value is negative.
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  if (text.length === 0) return fail('empty');

  // Reject anything that is not a digit or a separator before interpreting.
  if (!/^[\d.,]+$/.test(text)) return fail('not_a_number');

  // Step 4 — resolve the decimal separator.
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let decimalPos = -1;

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: the rightmost is the decimal separator.
    decimalPos = Math.max(lastDot, lastComma);
  } else if (lastDot !== -1 || lastComma !== -1) {
    const pos = lastDot !== -1 ? lastDot : lastComma;
    const separatorChar = text[pos] ?? '';
    const following = text.length - pos - 1;
    const occurrences = text.split(separatorChar).length - 1;

    if (occurrences > 1) {
      // A separator repeated with no other separator type is grouping — but
      // only if every group is well formed: "1.234.567" is grouping, while
      // "1.2.3" is nonsense.
      //
      // Valid grouping: first group 1..3 digits, every later group exactly 3.
      // `sep` is text[pos] for a found index, and split always yields at
      // least one part — so no fallbacks are needed here. Under
      // noUncheckedIndexedAccess the types are still `| undefined`, hence the
      // explicit non-null assertions rather than `??` branches that can never
      // be taken.
      // Destructuring narrows without a non-null assertion: `rest` is the
      // groups after the first, and `firstGroup === undefined` is impossible
      // because split always yields at least one element.
      const [firstGroup = '', ...rest] = text.split(separatorChar);
      const wellFormedGrouping =
        rest.length > 0 &&
        firstGroup.length >= 1 &&
        firstGroup.length <= 3 &&
        rest.every((part) => part.length === 3);

      if (wellFormedGrouping) {
        decimalPos = -1;
      } else {
        return fail('ambiguous_separators');
      }
    } else if (following >= 1 && following <= 2) {
      decimalPos = pos;
    } else if (following === 3) {
      // Three trailing digits are ambiguous: "1,234" is grouping, "1234.567"
      // is three decimals. The integer part settles it — a grouping separator
      // appears every three digits counting from the right, so the FIRST group
      // is 1..3 digits long. A longer lead cannot be a group boundary.
      //
      //   "1,234"      lead "1"     -> grouping     -> ₱1,234.00
      //   "1234.567"   lead "1234"  -> not grouping -> too many decimals
      //
      // The grouping reading is the deliberate product choice for the genuinely
      // ambiguous case: "1,234" means one thousand two hundred thirty-four, and
      // a user who means ₱1.23 can type "1.23".
      const lead = text.slice(0, pos).replace(/[.,]/g, '');
      decimalPos = lead.length >= 1 && lead.length <= 3 ? -1 : pos;
      if (decimalPos !== -1) return fail('too_many_decimals');
    } else {
      return fail('too_many_decimals');
    }
  }

  // Step 5 — split on the decimal separator and remove grouping.
  let majorDigits: string;
  let fractionDigits: string;

  if (decimalPos === -1) {
    majorDigits = text.replace(/[.,]/g, '');
    fractionDigits = '';
  } else {
    majorDigits = text.slice(0, decimalPos).replace(/[.,]/g, '');
    fractionDigits = text.slice(decimalPos + 1);
  }

  // No digit-shape guard here: the `/^[\d.,]+$/` check above already proved
  // the string contains only digits and separators, so stripping the
  // separators cannot leave a non-digit. A guard that can never fire is dead
  // code — it inflates the coverage denominator and implies a danger that does
  // not exist.

  // Step 6 — reject more precision than the currency has.
  if (fractionDigits.length > exponent) return fail('too_many_decimals');

  // Step 7 — compute on digit STRINGS. Never `major * 100` on a parsed float:
  // Math.round(parseFloat("19.99") * 100) is 1999 today, but the pattern is
  // one refactor from Math.floor and 1998.
  const paddedFraction = fractionDigits.padEnd(exponent, '0');
  const combined = `${majorDigits || '0'}${paddedFraction}`;

  // Reject before Number() can silently lose precision.
  if (combined.replace(/^0+/, '').length > 15) return fail('out_of_range');

  const magnitude = Number(combined);
  if (!Number.isSafeInteger(magnitude)) return fail('out_of_range');

  // Step 8 — apply sign.
  return { ok: true, minor: negative ? -magnitude : magnitude };
}

/**
 * Formats minor units for display.
 *
 * `minor / 100` here is the single permitted place a money value becomes a
 * float, and its result is a string that never re-enters arithmetic.
 */
export function formatMinor(
  minor: Minor,
  currency: string,
  locale = 'en-PH',
): string {
  const exponent = isSupportedCurrency(currency)
    ? currencyExponent(currency)
    : 2; /* v8 ignore next -- defensive: callers pass a supported currency */
  const divisor = 10 ** exponent;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / divisor);
}
