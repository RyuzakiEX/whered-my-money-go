# 0005 — Money is stored and computed as integer minor units

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Deciders** | @jorge |
| **Affects** | [data-model.md](../architecture/data-model.md), [money-and-rounding.md](../domain/money-and-rounding.md), every milestone touching an amount |

## Context

Every table in spec §22 carries an amount. Every calculation in spec §9–§18
operates on them. The representation is chosen once and is essentially
irreversible — changing it later means migrating every row and auditing every
line of arithmetic.

The constraint that decides it: **IEEE 754 binary floating point cannot
represent most decimal fractions.**

```text
0.1 + 0.2                    === 0.30000000000000004
1.005 * 100                  === 100.49999999999999   (rounds to 100, not 101)
0.07 * 3                     === 0.21000000000000002
```

In a budgeting app this compounds. Sum a few hundred transactions in floats and
a balance drifts by centavos; the derived `account_balances` view
([data-model.md](../architecture/data-model.md#derived-views)) sums *all* of a
user's transactions, so the error grows with account age. A user whose balance
reads `₱42,000.00000000001` has lost confidence in the entire product, and they
are right to.

## Decision

**All money is an integer count of the currency's minor unit** — centavos for
PHP. `₱1,234.56` is `123456`.

| Layer | Representation |
|---|---|
| Postgres | `bigint`, column suffixed `_minor` |
| TypeScript | `number` (safe integer), type alias `Minor` |
| Domain logic | Integer arithmetic only |
| Display | `Intl.NumberFormat` on `minor / 100`, at the display edge only |

Rules, in full in [money-and-rounding.md](../domain/money-and-rounding.md):

- **No `float`, `real`, `double precision`, or `numeric` in any arithmetic
  path.**
- **No `parseFloat` on user input.** Parse text directly to minor units,
  locale-aware.
- **Amounts stored positive**; direction comes from `transaction_type`.
- **Division rounds half-up** to the nearest minor unit, at the point of
  division.
- **Splitting uses largest-remainder allocation**, so parts always sum to the
  whole.
- **`minor / 100` appears exactly once**, in `lib/utils/money.ts`, producing a
  string that never re-enters arithmetic.

### On `number` rather than `bigint` in TypeScript

`Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 — about
**₱90 trillion** in centavos. Not a practical limit for personal finance, and
`number` avoids `bigint`'s serialisation problems (no JSON support, no mixing
with `number` in arithmetic) across the Server/Client Component boundary.
Postgres stays `bigint` because a column is cheap to widen and impossible to
narrow.

## Consequences

### What this makes easier

- **Addition and subtraction are exact.** Safe to Spend
  ([safe-to-spend.md](../domain/safe-to-spend.md)) only adds and subtracts, so
  it introduces no rounding at all. The timeline's running-balance fold is exact
  over any number of events.
- **Equality works.** `total === expected` in a test, with no epsilon.
- **The canonical fixtures are exact.** Spec §9's ₱23,500 is `2_350_000`, and
  the assertion is unconditional.
- **Rounding is explicit and localised.** Division appears in a handful of named
  places, each documented.
- **`bigint` in Postgres cannot silently lose precision** the way `numeric`
  arithmetic mixed with float casts can.

### What this makes harder

- **Every amount needs mental conversion.** `1_500_000` is ₱15,000. Mitigated by
  the `_minor` suffix, the `Minor` type alias, and numeric separators in
  fixtures.
- **Parsing is real work.** `"₱1,234.56"` → `123456` must handle thousands
  separators, currency symbols, and comma-vs-period decimals. Written once,
  tested thoroughly.
- **Division always needs a rounding decision.** No defaulting to float
  behaviour — which is the point, but it is more thought per line.
- **Percentages need care.** Category shares must sum to exactly 100%, hence
  largest-remainder (`M4-B02`).

### What this forecloses

- **Currencies with different minor-unit exponents**, if mixed. JPY has no minor
  unit; KWD has three digits. The MVP is single-currency per user, so the
  exponent is a per-user constant; true multi-currency would need the exponent
  stored alongside each amount.

## Alternatives considered

### Postgres `numeric(12,2)` with a decimal library in TypeScript

**What it was.** `numeric` is exact in Postgres; pair it with `decimal.js` or
`big.js` in the application.

**Why rejected.** `numeric` genuinely is exact — the problem is the boundary.
`supabase-js` returns `numeric` as a **JavaScript string** (to avoid precision
loss), so every read needs parsing into a decimal object and every write needs
serialising back. Miss one and you get silent float coercion: the exact bug this
decision exists to prevent, now harder to spot because it only appears on the
paths someone forgot.

It also adds a dependency to `lib/core`, which
[ADR-0003](0003-pure-typescript-domain-core.md) keeps dependency-free — and
decimal objects lose `===`, so every test assertion becomes a method call.

Integers give exactness with no dependency, no boundary conversion, and working
equality.

### Floating point with rounding at display time

**What it was.** Store `numeric`/`float`, compute in JS `number` as pesos, round
when displaying.

**Why rejected.** Error accumulates *before* display. The `account_balances`
view sums every transaction an account has ever had; rounding the total does not
undo drift already in it. And it fails silently — it works in testing with ten
transactions and breaks after a year of real use.

### `bigint` throughout TypeScript

**What it was.** Match Postgres exactly with JS `bigint`.

**Why rejected.** `bigint` does not serialise to JSON, so every Server → Client
Component boundary needs custom conversion. It cannot be mixed with `number` in
arithmetic without explicit casts, making percentage and ratio code noisy. And
the range `number` provides (₱90 trillion) is not a constraint for this product.

## Revisit when

- **Multi-currency arithmetic** becomes a requirement — the minor-unit exponent
  must then be stored per amount, not assumed per user.
- A currency with a non-2-digit minor unit is supported.
- Amounts could plausibly exceed `Number.MAX_SAFE_INTEGER` (they cannot, for
  personal finance).

## References

- [money-and-rounding.md](../domain/money-and-rounding.md) — the complete rules
- [data-model.md](../architecture/data-model.md) — the `_minor` columns
- [safe-to-spend.md](../domain/safe-to-spend.md) — why exact addition matters
- Spec §22 (amount fields), §32 (`₱` display)
