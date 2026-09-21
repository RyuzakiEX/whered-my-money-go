# Money and Rounding

> [!IMPORTANT]
> **Mandatory reading before writing or reviewing any code in `lib/core`.**
> Every other document in [../domain/](.) assumes the rules on this page.

**One sentence:** money is an integer count of **minor units** (centavos) from
the moment it is parsed at the input edge to the moment it is formatted at the
output edge, no float ever touches it, and any division states its rounding
rule and — when a total is being split — uses largest-remainder allocation so
the parts add up to the whole.

This document exists because financial software fails in a specific,
embarrassing, and entirely avoidable way: a report whose category shares sum to
99.99%, a goal that says "₱0.01 remaining" forever, a Safe to Spend that differs
by a centavo between the dashboard card and the detail page. None of those are
hard problems. They are all the same problem — floating point and unspecified
rounding — and this page bans the cause rather than patching the symptoms.

Related: [safe-to-spend.md](safe-to-spend.md),
[budget-forecasting.md](budget-forecasting.md),
[goal-projection.md](goal-projection.md),
[../architecture/source-structure.md](../architecture/source-structure.md) for
the layer rules, and
[../adr/0005-money-as-integer-minor-units.md](../adr/0005-money-as-integer-minor-units.md)
for the decision record.

## The representation

| Concern | Decision |
|---|---|
| Canonical unit | **Minor units** — centavos for PHP, 2 decimal places |
| Postgres column type | `bigint` (never `numeric`, never `money`, never `float8`) |
| TypeScript type | `number`, always integral — see [safe-integer ceiling](#the-safe-integer-ceiling) |
| Column naming | Suffix `_minor` on every money column: `amount_minor`, `balance_minor`, `target_amount_minor` |
| Field naming in domain types | Suffix `Minor`: `amountMinor`, `signedAmountMinor`, `projectedBalanceAfterMinor` |
| Sign convention | Positive = inflow, negative = outflow. Stored `amount_minor` is **unsigned**; `type` carries the direction, and `lib/core` signs it on the way in |
| Currency | A single `currency` code on `profiles` (spec §22). Amounts carry no per-value currency in the MVP |

The `_minor` / `Minor` suffix is not decoration. It is the review signal: a
money-looking identifier **without** the suffix is either a bug or a display
string, and both deserve a second look. A reviewer should be able to spot
`amount * 1.15` as wrong without knowing what the surrounding function does.

### Why integers, not `numeric`

Postgres `numeric` is exact, so it is tempting. Three reasons it loses anyway:

- **It arrives in JavaScript as a string.** `supabase-js` returns `numeric` as
  `string` to avoid precision loss, so every read needs a parse step, and the
  parse step is exactly where someone reaches for `parseFloat`.
- **Arithmetic has to happen somewhere.** If `lib/core` is the authority on
  money math — and it is, because What-If re-runs it with perturbed inputs —
  then the math happens in TypeScript, where `numeric` has no native form.
- **Integers make equality trivial.** `a === b` is correct for cents. For
  decimals it is a trap, and property tests need cheap, exact equality.

`bigint` in Postgres, `number` in TypeScript, with the boundary asserting
integrality. One representation, one comparison operator.

### Why not `bigint` in TypeScript too

It would be defensible, and it is the right answer for a currency-trading
system. It is the wrong answer here:

- `JSON.stringify` throws on `bigint`, which breaks the RSC payload boundary
  the whole architecture leans on.
- Mixed `bigint`/`number` arithmetic throws at runtime, so every literal needs
  an `n` suffix, forever, in thousands of test fixtures.
- The precision it buys is unreachable for this product — see below.

### The safe-integer ceiling

`Number.MAX_SAFE_INTEGER` is `9_007_199_254_740_991` minor units, which is
₱90,071,992,547,409.91 — about ninety trillion pesos. For a personal-finance
app whose users are young professionals and freelancers (spec §3), that is not a
practical limit; it is roughly a hundred times the money supply of the
Philippines.

The limit that *does* matter is intermediate overflow in aggregation, and it is
also unreachable: summing a hundred thousand transactions of ₱1,000,000 each
reaches 10^13 minor units, four orders of magnitude below the ceiling.

Still, encode the assumption rather than trusting it:

```typescript
/** Branded integer minor units. Constructed only via `toMinor`. */
export type Minor = number;

export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export function assertMinor(value: number, label: string): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer minor amount`, { value });
  }
  return value;
}
```

`assertMinor` runs at the boundaries of `lib/core` — on input construction and
on the results of division — not on every intermediate addition. Its job is to
catch a float that leaked in, and a leaked float shows up immediately.

## Banned constructs

These are lint-enforced where a rule can express them
([M0-B02](../../tasks/backlog/m0-foundation.md)) and review-enforced otherwise.

| Banned | Why | Instead |
|---|---|---|
| `parseFloat`, `Number(userInput)`, unary `+userInput` on money | Locale-blind and lossy: `Number("1,234.50")` is `NaN`, `parseFloat("1,234.50")` is `1` | [`parseMoneyInput`](#parsing-at-the-boundary) |
| Float literals in money paths — `0.15`, `amount * 1.12` | Introduces a non-representable value into an exact domain | Integer basis points, `bps` helpers |
| `numeric` / `decimal` / `real` / `double precision` columns for money | Forces a string boundary or a float boundary | `bigint` |
| `Math.round(a / b)` without a documented rule | JavaScript's `Math.round` is half-up **toward `+∞`**, so it is asymmetric for negatives: `Math.round(-2.5) === -2` | [`divideRoundHalfUp`](#division-and-rounding) |
| `toFixed(2)` to produce a value | Returns a string, rounds half-to-even-ish per engine, invites reparsing | `formatMoney` for display only |
| Naive per-part rounding when splitting a total | Parts stop summing to the whole | [`allocate`](#largest-remainder-allocation) |
| Percentages as floats (`0.9`, `0.15`) | Same non-representability, plus a units ambiguity: is `0.15` a ratio or 0.15%? | Basis points: `1500` bps = 15% |
| `Intl.NumberFormat` anywhere in `lib/core` | Formatting is locale I/O, and `lib/core` is pure and locale-free | `lib/utils/format-money.ts` |

### Percentages are basis points

Every threshold in the domain docs is an integer count of basis points, where
10,000 bps = 100%.

```typescript
/** Multiply `amountMinor` by `bps` basis points, rounding half-up. */
export function applyBps(amountMinor: Minor, bps: number): Minor {
  return divideRoundHalfUp(amountMinor * bps, 10_000);
}
```

So Safe to Spend's green band ("more than 15% of period income") is
`applyBps(periodIncomeMinor, 1500)`, and budget forecasting's at-risk band
("projected ≥ 90% of budget") is `applyBps(budgetMinor, 9000)`. No `0.15`
anywhere. The intermediate `amountMinor * bps` can reach 10^4 times the
amount — still far inside the safe range for any realistic balance, and
`divideRoundHalfUp` asserts the result.

## Parsing at the boundary

Parsing happens **once**, in `lib/validation`, inside the Zod schema for the
form field — never in `lib/core` (which never sees a string) and never in a
component (which must not own a money rule).

The input problem is real. A Filipino user typing an amount may produce any of:

| Typed | Intended | Note |
|---|---|---|
| `1234.5` | ₱1,234.50 | Bare, one decimal place |
| `1,234.50` | ₱1,234.50 | `en-PH` thousands separator |
| `₱1,234.50` | ₱1,234.50 | Symbol prefix, possibly with NBSP |
| `PHP 1234.50` | ₱1,234.50 | Code prefix |
| `1.234,50` | ₱1,234.50 | `de-DE`-style, from a pasted value |
| `1 234,50` | ₱1,234.50 | NBSP/thin-space grouping |
| `(1,234.50)` | −₱1,234.50 | Accounting negative, from a pasted spreadsheet cell |
| `1234.567` | — | **Reject.** More precision than the currency has |
| `1.2.3` | — | **Reject.** Ambiguous |
| `` (empty) | — | **Reject.** Not zero — the field is required |

Algorithm, in order:

```text
1. Trim. Normalize Unicode spaces (U+00A0, U+202F, U+2009) to nothing.
2. Strip the currency symbol and ISO code for the PROFILE currency only.
   An unrecognized symbol is an error, not something to strip — see
   "Mixed currency is an error".
3. Detect accounting negation: a fully parenthesized value becomes negative.
4. Resolve the decimal separator:
     - exactly one of `.` or `,` present, and 1..2 digits follow it
         -> that character is the decimal separator
     - both present -> the RIGHTMOST is the decimal separator
     - one present with 3 digits following and no other separator
         -> AMBIGUOUS ("1,234"): treat as a GROUPING separator, value 1234
     - none present -> integer major units
5. Remove all grouping separators. Reject any remaining non-digit,
   non-sign, non-decimal character.
6. Reject if the fractional part is longer than the currency's exponent (2).
7. minor = majorDigits * 100 + fractionalDigits, zero-padded on the right.
   Compute on integer digit strings — never `major * 100` on a parsed float.
8. Apply sign. Assert safe integer. Return.
```

Step 4's ambiguous case is a deliberate product choice: `1,234` means one
thousand two hundred thirty-four pesos, not ₱1.23. Grouping is the far more
common intent, and a user who means ₱1.23 can type `1.23`.

Step 7 matters more than it looks. `Math.round(parseFloat("19.99") * 100)` is
`1999` today and will be `1999` tomorrow, but the pattern is one refactor away
from `Math.floor`, which yields `1998`. Working on digit substrings makes the
whole class of error impossible.

```typescript
export type ParseMoneyResult =
  | { ok: true; minor: Minor }
  | { ok: false; reason: ParseMoneyError };

export type ParseMoneyError =
  | 'empty'
  | 'not_a_number'
  | 'too_many_decimals'
  | 'ambiguous_separators'
  | 'foreign_currency'
  | 'out_of_range';

export function parseMoneyInput(
  raw: string,
  currency: CurrencyCode,
): ParseMoneyResult;
```

Returning a result rather than throwing is what lets the Zod schema turn a
`reason` into field-level copy the user can act on ("That looks like more
centavos than pesos have") instead of a generic "Invalid number".

## Division and rounding

Only three places in the domain divide, and each is named here so a fourth is
visible in review:

| Site | Expression | Doc |
|---|---|---|
| Required monthly contribution | `(target − current) / monthsUntil` | [goal-projection.md](goal-projection.md) |
| Linear run-rate | `spentToDate / daysElapsed × daysInPeriod` | [budget-forecasting.md](budget-forecasting.md) |
| Percentage-of thresholds | `amount × bps / 10000` | this page |

All three round **half-up away from zero** to the nearest minor unit.

```typescript
/**
 * Divide, rounding halves away from zero.
 *   7 / 2   ->  4      (not 3)
 *  -7 / 2   -> -4      (not -3 — this is where Math.round is wrong)
 *   1 / 3   ->  0
 * Throws on a zero divisor; callers must handle the zero case explicitly,
 * because "what does an empty period mean" is a domain question, not a
 * rounding question.
 */
export function divideRoundHalfUp(numerator: number, denominator: number): Minor {
  if (denominator === 0) throw new MoneyError('division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const q = Math.abs(numerator);
  const d = Math.abs(denominator);
  return assertMinor(sign * Math.floor((2 * q + d) / (2 * d)), 'quotient');
}
```

Half-up-away-from-zero, rather than banker's rounding, because the amounts here
are targets and projections shown to a person, and "round the half up" is what
a person expects when they check the arithmetic by hand. Banker's rounding is
the right choice for summing thousands of independent values where bias
matters; nothing in this product does that. The choice is recorded so nobody
"fixes" it later.

The zero-divisor throw is load-bearing. `daysElapsed = 0` on the first day of a
period and `monthsUntil = 0` for a goal due this month are both real states, and
each has a *domain* answer — see the edge-case tables in the respective docs.
Silently returning `0` or `Infinity` would push a nonsense number into the UI.

### Rounding direction, deliberately chosen per site

Half-up is the default. Two sites override it, and both overrides are in the
user's favour:

- **Required monthly contribution** rounds **up** (ceiling), not half-up. If
  ₱10,000 is needed over 3 months, ₱3,333 × 3 = ₱9,999 misses the goal by a
  centavo, and a goal tracker that says "on track" while falling short is worse
  than one that asks for ₱3,334.
- **Safe to Spend** never rounds at all — every term is already an integer
  count of minor units, and the identity is pure addition. If a rounding call
  appears in `computeSafeToSpend`, something upstream is wrong.

## Largest-remainder allocation

Splitting one total across N buckets is where naive rounding visibly breaks:
₱100.00 three ways at half-up gives ₱33.33 × 3 = ₱99.99, and a centavo
disappears. **Largest remainder** (a.k.a. Hare quota) fixes it by distributing
the leftover minor units to the buckets with the largest fractional parts.

```text
allocate(totalMinor, weights[]) -> partsMinor[]

1. W = sum(weights).  If W == 0 -> error (nothing to allocate against).
2. For each i:
     exact_i     = totalMinor * weights[i] / W        (rational, not evaluated)
     floor_i     = trunc toward zero of exact_i
     remainder_i = totalMinor * weights[i] - floor_i * W    (integer, 0..W-1)
3. assigned = sum(floor_i)
   leftover  = totalMinor - assigned                  (0 <= leftover < N)
4. Sort indices by remainder_i DESC, tie-broken by ORIGINAL INDEX ASC.
5. Give +1 minor unit (or -1 when totalMinor is negative) to the first
   `|leftover|` indices in that order.
6. Return in original order.
```

Two properties do the work:

- **Sum preservation.** `sum(parts) === totalMinor`, exactly, always. This is
  the invariant that makes the function worth having.
- **Determinism.** Ties break on original index, so the same input always
  yields the same output — snapshot tests and cache keys depend on it. Never
  break ties by "whichever floating-point remainder compared larger"; compute
  remainders as integers, as step 2 does.

```typescript
export function allocate(totalMinor: Minor, weights: readonly number[]): Minor[];

/** Convenience: N equal parts. `allocateEvenly(10_000, 3)` -> [3334, 3333, 3333]. */
export function allocateEvenly(totalMinor: Minor, parts: number): Minor[];
```

### Worked example — ₱100.00 split three ways

`allocate(10_000, [1, 1, 1])`:

| Bucket | Weight | Exact | Floor | Remainder | +1? | Part | Formatted |
|---|---|---|---|---|---|---|---|
| 0 | 1 | 3333.33 | 3333 | 1 | yes | **3334** | ₱33.34 |
| 1 | 1 | 3333.33 | 3333 | 1 | — | **3333** | ₱33.33 |
| 2 | 1 | 3333.33 | 3333 | 1 | — | **3333** | ₱33.33 |
| | 3 | | 9999 | | | **10000** | **₱100.00** |

`leftover = 10000 − 9999 = 1`. All three remainders tie at 1, so the original
index breaks it and bucket 0 takes the extra centavo. Sum is exactly ₱100.00.

### Worked example — category shares summing to exactly 100%

The spending breakdown (spec §8) shows percentage shares. Computing each as
`round(part / total × 100)` produces columns that sum to 99% or 101% and a
support ticket. Allocate the *percentage points* instead — in basis points, so
one decimal place of percentage survives.

Spend: Food ₱7,200 · Transportation ₱4,800 · Entertainment ₱2,100 ·
Shopping ₱5,400. Total ₱19,500. `allocate(10_000, [720_000, 480_000, 210_000, 540_000])`
— weights are the minor amounts themselves:

| Category | Spend | Exact % | Floor bps | Remainder | +1? | Final bps | Shown |
|---|---|---|---|---|---|---|---|
| Food | ₱7,200 | 36.923% | 3692 | 0.3077·W | yes | **3693** | 36.9% |
| Transportation | ₱4,800 | 24.615% | 2461 | 0.5385·W | yes | **2462** | 24.6% |
| Entertainment | ₱2,100 | 10.769% | 1076 | 0.9231·W | yes | **1077** | 10.8% |
| Shopping | ₱5,400 | 27.692% | 2769 | 0.2308·W | — | **2769** | 27.7% |
| | **₱19,500** | 100% | 9998 | | leftover 2 | **10000** | **100.0%** |

Wait — `leftover` is 2 but three buckets got `+1`. That is the tell for a bug in
a hand-worked table, so here it is done exactly: floors are 3692, 2461, 1076,
2769, summing to **9998**, so `leftover = 2` and only the two largest
remainders receive it — Entertainment (0.9231) and Transportation (0.5385).
Final: **3692 / 2462 / 1077 / 2769 = 10000**. Displayed as 36.9% / 24.6% /
10.8% / 27.7%, which sums to 100.0%.

That correction is left visible on purpose: the "obvious" allocation is easy to
get wrong by eye, which is precisely why it belongs in a tested function rather
than in a component's render body.

## Display formatting

Formatting lives in **`lib/utils/format-money.ts`**, never in `lib/core`. The
import matrix in
[../architecture/source-structure.md](../architecture/source-structure.md)
enforces it: `lib/core` may not import `Intl`, and `lib/utils` may not import
`lib/core` internals.

The separation is not pedantry. `Intl.NumberFormat` output depends on the ICU
data of whatever runtime is executing — and Node on Vercel, Node in CI, and a
user's browser do not always agree on spacing or symbol placement. A pure core
that returned formatted strings would make snapshot tests flaky for reasons
that have nothing to do with money math. Core returns integers; the edge makes
them pretty.

```typescript
export function formatMoney(
  minor: Minor,
  currency: CurrencyCode,
  opts?: {
    /** Drop `.00` when the amount is whole. Default false. */
    compactZeroFraction?: boolean;
    /** Always show `+` for positives — used by the timeline. Default false. */
    signDisplay?: 'auto' | 'always';
    /** BCP-47 locale. Defaults to the profile locale, then 'en-PH'. */
    locale?: string;
  },
): string;
```

| Input (minor) | Currency | Options | Output |
|---|---|---|---|
| `2_350_000` | PHP | — | `₱23,500.00` |
| `2_350_000` | PHP | `compactZeroFraction` | `₱23,500` |
| `3_500_000` | PHP | `signDisplay: 'always'` | `+₱35,000.00` |
| `-1_500_000` | PHP | — | `-₱15,000.00` |
| `-1_500_000` | PHP | `signDisplay: 'always'` | `-₱15,000.00` |
| `0` | PHP | — | `₱0.00` |
| `1` | PHP | — | `₱0.01` |

PHP with the `₱` symbol is the default per spec §22 (`profiles.currency`, seeded
`PHP`, timezone `Asia/Manila`). Implementation notes that keep it stable:

- Construct with `{ style: 'currency', currency, currencyDisplay: 'narrowSymbol' }`.
  Without `narrowSymbol`, some ICU builds render `PHP 23,500.00`.
- **Memoize the formatter** by `(locale, currency, options)`. Constructing
  `Intl.NumberFormat` is expensive, and a transaction list renders hundreds.
- `minimumFractionDigits` and `maximumFractionDigits` both come from the
  currency exponent — never hardcode `2`, so a zero-decimal currency (JPY) does
  not gain phantom centavos when one is eventually supported.
- For accessibility, negatives get a real minus sign from `Intl`; do not
  hand-build `"-" + formatMoney(abs)`, which double-signs in some locales.

## Single currency per user

**One currency per user for the MVP.** `profiles.currency` is the currency of
every account, transaction, budget, and goal that user owns. A row whose
currency differs from the profile's is an **error**, not a value to convert.

```typescript
export class MixedCurrencyError extends MoneyError {
  constructor(
    readonly expected: CurrencyCode,
    readonly found: CurrencyCode,
    readonly context: string,
  ) { /* ... */ }
}
```

Every `lib/core` entry point that accepts a collection asserts currency
homogeneity *before* summing, and throws on the first mismatch.

Throwing rather than converting, and rather than silently adding:

- **Correct multi-currency needs a rate at a point in time**, an exchange-rate
  source, and a decision about whether Safe to Spend is quoted at today's rate
  or the rate on the bill's due date. Those are product questions with no
  obvious answer and no MVP demand (spec §3, §26 — the target user has GCash,
  Maya, and a bank account, all in pesos).
- **Silently adding is the actively dangerous option.** ₱42,000 + $500 = 42,500
  of nothing renders as `₱42,500.00`, looks plausible, and is off by an order of
  magnitude. A thrown error is a bug report; a plausible wrong number is a user
  who trusted us and shouldn't have.
- **Throwing keeps the door open.** Adding conversion later widens the contract
  (mismatch becomes legal); loosening a check is a safe change, tightening one
  after users have mixed-currency data is a migration.

The migration story if it is ever needed: currency stays where it is
(`accounts.currency`, spec §22), the assertion becomes a conversion at the
`lib/core` boundary against an injected rate table, and `lib/core` stays pure
because the rates are *injected* — the same reason `today` is.
[system-architecture.md](../architecture/system-architecture.md#non-goals)
records this as an explicit non-goal.

## Function contract

The `lib/core/money/` module surface in full. Everything else in `lib/core`
routes its arithmetic through these.

```typescript
// lib/core/money/index.ts

export type Minor = number;
export type CurrencyCode = 'PHP' | 'USD' | 'EUR' | 'JPY' | (string & {});

export interface Money {
  readonly minor: Minor;
  readonly currency: CurrencyCode;
}

// --- construction & assertion -------------------------------------------
export function assertMinor(value: number, label: string): Minor;
export function money(minor: Minor, currency: CurrencyCode): Money;
export function currencyExponent(currency: CurrencyCode): number; // PHP -> 2

// --- arithmetic (all total, all exact) ----------------------------------
export function addMinor(...values: readonly Minor[]): Minor;
export function subMinor(a: Minor, b: Minor): Minor;
export function negateMinor(a: Minor): Minor;
export function sumMinor(values: readonly Minor[]): Minor;      // [] -> 0
export function clampMinAtZero(a: Minor): Minor;                 // max(0, a)

// --- division, rounding, scaling ----------------------------------------
export function divideRoundHalfUp(numerator: number, denominator: number): Minor;
export function divideRoundUp(numerator: number, denominator: number): Minor;
export function applyBps(amountMinor: Minor, bps: number): Minor;
export function bpsOf(partMinor: Minor, wholeMinor: Minor): number; // 0 whole -> 0

// --- allocation ---------------------------------------------------------
export function allocate(totalMinor: Minor, weights: readonly number[]): Minor[];
export function allocateEvenly(totalMinor: Minor, parts: number): Minor[];

// --- currency guards ----------------------------------------------------
export function assertSameCurrency(
  expected: CurrencyCode,
  items: readonly { currency: CurrencyCode }[],
  context: string,
): void;

// --- errors -------------------------------------------------------------
export class MoneyError extends Error {}
export class MixedCurrencyError extends MoneyError {}
```

Two notes on shape:

- **`sumMinor([])` is `0`, not an error.** An empty term list is a normal
  state — a user with no upcoming bills has `UpcomingExpenses = 0` — and
  forcing every caller to special-case it would put the zero-handling in five
  places instead of one.
- **`bpsOf` returns `0` for a zero whole**, deliberately, because it feeds
  progress bars ("0% of a ₱0 budget" renders fine as an empty bar) rather than
  money. It is not in the money path, which is why it may be lenient where
  `divideRoundHalfUp` may not.

## Edge cases

| Case | Behaviour | Why |
|---|---|---|
| `parseMoneyInput("")` | `{ ok: false, reason: 'empty' }` | Empty is not zero; the field is required and the copy differs |
| `parseMoneyInput("0")` | `{ ok: true, minor: 0 }` | Zero is a legal amount (a ₱0 correcting entry) |
| `parseMoneyInput("1,234")` | `1_234_00` | Grouping wins over decimal for a 3-digit group |
| `parseMoneyInput("1.5")` | `150` | One decimal place, zero-padded right |
| `parseMoneyInput("1.567")` | `'too_many_decimals'` | Never silently round user input — ask |
| `parseMoneyInput("1.2.3")` | `'ambiguous_separators'` | No defensible interpretation |
| `parseMoneyInput("(500)")` | `-50_000` | Accounting negative, common in pasted data |
| `parseMoneyInput("$5.00", 'PHP')` | `'foreign_currency'` | Do not strip a symbol that is not the profile's |
| `parseMoneyInput("1e6")` | `'not_a_number'` | Exponent notation is a paste artefact, not intent |
| `divideRoundHalfUp(x, 0)` | throws `MoneyError` | Callers own the domain meaning of an empty denominator |
| `divideRoundHalfUp(-7, 2)` | `-4` | Half away from zero; `Math.round` would give `-3` |
| `divideRoundHalfUp(7, -2)` | `-4` | Sign is the product of both signs |
| `allocate(0, [1,1,1])` | `[0, 0, 0]` | Zero total splits to zeros; sum invariant holds |
| `allocate(100, [])` | throws | Nothing to allocate against — a caller bug, loudly |
| `allocate(100, [0, 0])` | throws (`W === 0`) | Same: no basis for a split |
| `allocate(-10_000, [1,1,1])` | `[-3334, -3333, -3333]` | Leftover moves the same direction as the total |
| `allocate(2, [1,1,1])` | `[1, 1, 0]` | Fewer minor units than buckets; sum still exact |
| `allocate(10_000, [3, 0, 1])` | `[7500, 0, 2500]` | A zero weight gets exactly zero, never a rounding crumb |
| `sumMinor([])` | `0` | Documented identity, relied on by every term in STS |
| `formatMoney(0, 'PHP')` | `"₱0.00"` | Never `"-₱0.00"`; normalize negative zero at the edge |
| `applyBps(x, 0)` | `0` | 0% of anything |
| `applyBps(x, 10_000)` | `x` exactly | 100% must be the identity, not a rounding trip |
| Mixed currency in a sum | throws `MixedCurrencyError` | See [above](#single-currency-per-user) |
| Non-integer sneaks into `assertMinor` | throws | The float leak is caught at the nearest boundary |

## Invariants for property tests

Fast-check style, over `Minor` generators bounded to ±10^12 so intermediate
`× 10_000` stays safe.

| # | Invariant | Statement |
|---|---|---|
| **M1** | Allocation sums | `sum(allocate(t, w)) === t` for all `t`, all `w` with `sum(w) > 0` |
| **M2** | Allocation length | `allocate(t, w).length === w.length` |
| **M3** | Allocation determinism | `allocate(t, w)` equals itself across repeated calls and array copies |
| **M4** | Allocation fairness | `max(parts_i / w_i) − min(parts_j / w_j)` never exceeds one minor unit per unit weight |
| **M5** | Zero weight, zero part | `w[i] === 0 ⇒ allocate(t, w)[i] === 0` |
| **M6** | Allocation sign | `sign(part_i) ∈ {0, sign(t)}` — no part flips against the total |
| **M7** | Division bound | `abs(divideRoundHalfUp(n, d) × d − n) ≤ abs(d) / 2` |
| **M8** | Division sign | `sign(divideRoundHalfUp(n, d)) ∈ {0, sign(n) × sign(d)}` |
| **M9** | Division antisymmetry | `divideRoundHalfUp(-n, d) === -divideRoundHalfUp(n, d)` |
| **M10** | Bps identity | `applyBps(x, 10_000) === x` |
| **M11** | Bps monotonicity | `b1 ≤ b2 ∧ x ≥ 0 ⇒ applyBps(x, b1) ≤ applyBps(x, b2)` |
| **M12** | Sum associativity | `sumMinor([...a, ...b]) === addMinor(sumMinor(a), sumMinor(b))` |
| **M13** | Parse round-trip | for integral `m`, `parseMoneyInput(formatMoney(m, c), c)` yields `{ ok: true, minor: m }` |
| **M14** | Parse idempotence | parsing succeeds ⇒ re-formatting and re-parsing is a fixed point |
| **M15** | Parse never loses precision | a successful parse's `minor` is a safe integer |
| **M16** | Integrality closure | every exported function returning `Minor` returns a safe integer |
| **M17** | Format injectivity | distinct `Minor` values format to distinct strings for a fixed locale/currency |

M13 is the one that catches the most real bugs — it ties the two boundaries
together, so a locale-formatting change that the parser cannot read back fails
CI immediately.

M4 deserves a word: it is the *fairness* half of largest-remainder. M1 alone is
satisfied by the cheating implementation "give the whole total to bucket 0",
so the sum invariant needs a companion that pins distribution.

## Canonical unit-test fixtures

These exact cases live in `tests/unit/core/money.test.ts` and are referenced by
name from the other domain docs.

### `MONEY_FIXTURE_ALLOCATE_100_THREE_WAYS`

```typescript
{
  totalMinor: 10_000,          // ₱100.00
  weights: [1, 1, 1],
  expected: [3334, 3333, 3333],
  expectedSum: 10_000,
}
```

### `MONEY_FIXTURE_CATEGORY_SHARES` — spec §11's budget table

```typescript
{
  totalBps: 10_000,
  categories: [
    { name: 'Food',           spentMinor: 720_000 },
    { name: 'Transportation', spentMinor: 480_000 },
    { name: 'Entertainment',  spentMinor: 210_000 },
    { name: 'Shopping',       spentMinor: 540_000 },
  ],
  totalSpentMinor: 1_950_000,  // ₱19,500.00
  expectedBps: [3692, 2462, 1077, 2769],
  expectedBpsSum: 10_000,
  expectedDisplay: ['36.9%', '24.6%', '10.8%', '27.7%'],
}
```

### `MONEY_FIXTURE_PARSE_TABLE`

Every row of the [parsing table](#parsing-at-the-boundary) and the parse rows
of the [edge-case table](#edge-cases), as `[input, currency, expected]`
triples, driven by a single `it.each`. New locale bug reports get a row here
first and a fix second.

### `MONEY_FIXTURE_ROUNDING_TABLE`

```typescript
[
  [ 7,  2,  4], [ -7, 2, -4], [ 7, -2, -4], [ -7, -2,  4],
  [ 5,  2,  3], [ -5, 2, -3], [ 1,  3,  0], [  2,  3,  1],
  [ 0,  5,  0], [ 10, 5,  2],
]
```

The four sign combinations of `7 / 2` are the whole point: a naive
`Math.round(n / d)` passes the first row and fails the second.

## How to review money code

A checklist for pull requests. Any "no" is a blocking comment.

1. **Does every money identifier end in `Minor` or `_minor`?** If not, is it
   genuinely a display string or a non-money quantity?
2. **Is there a float literal anywhere near money?** Search the diff for `0.`,
   `.5`, `* 1.`, `/ 100`. Percentages must be basis points.
3. **Is there a `parseFloat`, `Number(...)` on a string, unary `+`, or
   `toFixed`?** Parsing belongs in `lib/validation` via `parseMoneyInput`;
   `toFixed` never produces a value.
4. **Does every division call `divideRoundHalfUp` / `divideRoundUp`?** A bare
   `/` in a money path is only acceptable when the result feeds another
   integer-exact expression, and that deserves a comment.
5. **Does every division's zero-denominator case have a domain answer?** Not a
   `?? 0` — an actual documented behaviour with a row in an edge-case table.
6. **Is a total being split across buckets?** Then it uses `allocate`, and
   there is a test asserting the parts sum to the total.
7. **Is currency asserted before summing?** Any function taking a collection of
   money must call `assertSameCurrency` first.
8. **Is `Intl` being touched outside `lib/utils`?** Move it. Is a formatted
   string being returned from `lib/core`? Move it.
9. **Is `today` a parameter?** No `new Date()`, no `Date.now()` in `lib/core`.
   See [recurrence.md](recurrence.md) for why the clock is poison here.
10. **Are the new fixtures in a table, driven by `it.each`?** One-off `expect`
    calls do not accumulate into a regression net.
11. **Does the Postgres column type match?** `bigint`, `NOT NULL`, and a
    `CHECK` where the domain has a sign constraint (`amount_minor > 0` on
    transactions, since `type` carries direction).
12. **Would a reviewer who knows nothing about this feature spot the bug?** If
    the correctness of the arithmetic depends on context elsewhere in the file,
    add the comment that supplies it.
