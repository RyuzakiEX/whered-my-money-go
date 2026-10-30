/**
 * The currencies the MVP supports, and what each one looks like when typed.
 *
 * The allowlist was decided 2026-10-30 and is mirrored by the
 * `profiles_currency_allowed` check constraint. Adding a currency means a new
 * migration there AND an entry here — a currency the database accepts but this
 * module cannot parse is an account whose every amount is rejected.
 *
 * See docs/domain/money-and-rounding.md.
 */

export const SUPPORTED_CURRENCIES = ['PHP', 'USD', 'EUR', 'JPY'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Minor-unit exponent: how many decimal places the currency has. JPY has no
 * minor unit, so ¥1,234 is stored as 1234 — never as 123400.
 */
const EXPONENTS: Readonly<Record<SupportedCurrency, number>> = {
  PHP: 2,
  USD: 2,
  EUR: 2,
  JPY: 0,
};

/**
 * Symbols and ISO codes a user may type for each currency, uppercase. Order
 * does not matter: the parser matches longest first, so `US$` wins over `$`.
 */
export const CURRENCY_MARKERS: Readonly<
  Record<SupportedCurrency, readonly string[]>
> = {
  PHP: ['PHP', '₱'],
  USD: ['USD', 'US$', '$'],
  EUR: ['EUR', '€'],
  JPY: ['JPY', '¥', '￥'],
};

/**
 * Markers of currencies outside the allowlist. Always an error to type: an
 * unrecognised symbol is never stripped, because silently reading `£10` as
 * ₱10 is invisible until it has corrupted a balance.
 */
export const UNSUPPORTED_MARKERS: readonly string[] = [
  '£',
  '₩',
  '₹',
  '₫',
  '฿',
  'RM',
  'S$',
  'A$',
  'GBP',
  'KRW',
  'INR',
  'SGD',
  'AUD',
  'MYR',
  'THB',
];

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

export function currencyExponent(currency: SupportedCurrency): number {
  return EXPONENTS[currency];
}
