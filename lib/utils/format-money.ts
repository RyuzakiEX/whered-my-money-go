// Money for display (docs/domain/money-and-rounding.md#display-formatting).
//
// The display edge, never lib/core: Intl output depends on the runtime's ICU
// data, and a pure core must not. `minor / 10 ** exponent` here is the single
// permitted place a money value becomes a float, and its result is a string
// that never re-enters arithmetic.

export interface FormatMoneyOptions {
  /** Drop `.00` when the amount is whole. Default false. */
  compactZeroFraction?: boolean;
  /** Always show `+` for positives. Default 'auto'. */
  signDisplay?: 'auto' | 'always';
  /** BCP-47 locale. Defaults to 'en-PH'. */
  locale?: string;
}

const formatters = new Map<string, Intl.NumberFormat>();
const exponents = new Map<string, number>();

/**
 * The currency's minor-unit exponent as ICU knows it (ISO 4217): 2 for PHP,
 * 0 for JPY. A unit test holds it equal to lib/core's `currencyExponent`, so
 * the parser and the display cannot disagree about decimals.
 */
function exponentOf(currency: string): number {
  const known = exponents.get(currency);
  if (known !== undefined) return known;
  const exponent = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
  /* v8 ignore next 3 -- ICU always resolves digits for a currency style */
  if (exponent === undefined) {
    throw new Error(`no minor-unit exponent for ${currency}`);
  }
  exponents.set(currency, exponent);
  return exponent;
}

function formatterFor(
  currency: string,
  locale: string,
  signDisplay: 'auto' | 'always',
  fractionDigits: number,
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${signDisplay}|${String(fractionDigits)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // Without narrowSymbol some ICU builds render `PHP 23,500.00`.
      currencyDisplay: 'narrowSymbol',
      // 'exceptZero': `+` for positives, and never `+₱0.00` or `-₱0.00`.
      signDisplay: signDisplay === 'always' ? 'exceptZero' : 'auto',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** `₱23,500.00` from `2350000`. Negatives get Intl's own minus sign. */
export function formatMoney(
  minor: number,
  currency: string,
  opts: FormatMoneyOptions = {},
): string {
  const exponent = exponentOf(currency);
  const whole = minor % 10 ** exponent === 0;
  const fractionDigits = opts.compactZeroFraction && whole ? 0 : exponent;
  // `|| 0` turns -0 into 0, so a zero balance never renders as `-₱0.00`.
  const major = minor / 10 ** exponent || 0;
  return formatterFor(
    currency,
    opts.locale ?? 'en-PH',
    opts.signDisplay ?? 'auto',
    fractionDigits,
  ).format(major);
}

/** The currency's narrow symbol on its own — `₱` — for an input adornment. */
export function currencySymbol(currency: string, locale = 'en-PH'): string {
  return (
    formatterFor(currency, locale, 'auto', 0)
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}

/**
 * Minor units as plain decimal text for an input to edit — `1000.50`, with no
 * symbol and no grouping — which the parser reads back to the same value.
 * Digits are written out from the integer, not through a float, so nothing
 * can round on the way into a form the user will save.
 */
export function formatMinorForInput(minor: number, currency: string): string {
  const exponent = exponentOf(currency);
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  const sign = minor < 0 ? '-' : '';
  if (exponent === 0) return `${sign}${digits}`;
  const cut = digits.length - exponent;
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}
