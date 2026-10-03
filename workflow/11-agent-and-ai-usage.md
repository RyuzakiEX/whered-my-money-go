# AI-Assisted Development

**The rule:** AI can write anything here, but a human owns anything whose
failure is unrecoverable or invisible.

This project is AI-assisted and says so. The point of this document is not
permission — it is drawing the line where review has to be real.

> [!IMPORTANT]
> The operating contract Claude Code follows lives in
> [`CLAUDE.md`](../CLAUDE.md): the three-phase task workflow (plan →
> implement → PR), the non-negotiables, and the honesty requirements.
> This document covers attribution and what a human must review.

## Attribution

Add the trailer to AI-assisted commits:

```text
feat(sts): add safe-to-spend breakdown computation

Refs #42

Co-Authored-By: Claude <noreply@anthropic.com>
```

Honest history costs nothing and is worth something later: `git log --grep` can
answer "which parts were AI-drafted?" if a pattern of subtle bugs ever shows up
in one.

## Requires human review before merge

Not "AI cannot touch these" — AI drafting them is fine and often good. But a
human reads every line, and the PR states that they did.

| Area | Why |
|---|---|
| **`supabase/migrations/**`** | **A bad migration on financial data is unrecoverable.** No down-migrations, and a dropped column is deleted transactions. |
| **RLS policies** | A wrong policy is a data breach that no test catches unless someone wrote the right test. Especially the [cross-table case](../docs/architecture/rls-policies.md#cross-table-ownership) — a plausible-looking policy passes every naive check. |
| **`lib/core` money math** | A wrong number is worse than a crash. It looks like an answer. |
| **`.github/workflows/**`** | CI runs with repository write potential. A workflow change is a supply-chain change. |
| **Secrets, `.env*`** | Never AI-authored. |
| **Auth flows** | Session handling, redirects, password reset — spec §24's requirements. |
| **Anything deleting data** | Destructive by definition. |

### The money-math rule

> **AI-authored money math is never merged without the canonical fixture from
> its domain doc passing as a test.**

The reason is specific. Ask for a Safe to Spend implementation and you will
likely get something that looks right, handles the happy path, and quietly
mishandles month-end, or double-counts a bill paid early, or drops the exclusion
flag. Those are exactly the cases
[safe-to-spend.md](../docs/domain/safe-to-spend.md) enumerates — and exactly
what plausible-looking code omits.

The fixtures exist for this: spec §9's ₱23,500 either comes out or it does not.
No amount of confident explanation substitutes.

Same for [recurrence](../docs/domain/recurrence.md) — month-end anchor
preservation (Jan 31 → Feb 28 → **Mar 31**) is a rule an implementation will
plausibly get wrong in a way no reviewer notices without the test.

## Well suited to AI

| Area | Notes |
|---|---|
| **Documentation** | Most of `/docs` was AI-drafted, human-reviewed. |
| **Tests** | Especially exhaustive edge-case tables. Review that assertions are meaningful, not just present. |
| **Boilerplate CRUD** | Following an established pattern in the repo. |
| **Refactors under a green suite** | The tests are the safety net. |
| **Component scaffolding** | Then a human checks a11y and responsive behaviour. |
| **Backlog and acceptance criteria** | Human sets priorities and scope. |
| **Type definitions, Zod schemas** | The compiler checks the work. |

## Reviewing AI-written code

The failure mode is different from human code. A human writing something they
half-understand usually leaves a hesitant comment. AI produces uniformly
confident code, so confidence carries no signal.

Look for:

- **Plausible-but-wrong constants.** `daysInPeriod = 30` instead of the real
  month length. Reads fine, wrong every February.
- **Missing edge cases from the doc.** The domain docs list them in tables —
  check each one is handled, not just the common path.
- **Silent `catch {}`** swallowing errors.
- **Float arithmetic on money.** `amount / 100` mid-calculation rather than at
  the display edge only.
- **`new Date()` in `lib/core`.** Banned; `today` is injected
  ([ADR-0003](../docs/adr/0003-pure-typescript-domain-core.md)).
- **Ownership checks omitted** because RLS "already handles it". It does not —
  [the three-layer rule](../docs/security/security-model.md#the-three-layer-rule).
- **Tests asserting the implementation** rather than the specification —
  `expect(result).toBe(whateverTheCodeReturns)`.
- **Invented API surface.** Options or methods that do not exist on the real
  library version.
- **Docs describing intent rather than behaviour.** A doc confidently describing
  code that was never written is worse than no doc — it will be trusted.

## Prompting that works here

The docs are the leverage. `/docs` exists partly so AI has a specification to
work from rather than inventing one:

| Instead of | Say |
|---|---|
| "Implement Safe to Spend" | "Implement `computeSafeToSpend` per `docs/domain/safe-to-spend.md`. Start with the `STS_FIXTURE_SPEC_S9` test." |
| "Add an accounts table" | "Write the M2-B01 migration per `docs/architecture/data-model.md`, including RLS per `docs/architecture/rls-policies.md`." |
| "Make the dashboard" | "Build M4-F01's metric tiles per its acceptance criteria. Money comes in as props — components never compute it." |

Point at the doc and the fixture. Ambiguity is where plausible-and-wrong comes
from, and the docs exist to have already removed it.

## Non-negotiables

Regardless of who or what wrote the code:

1. **Money is integer minor units.** No floats.
   [ADR-0005](../docs/adr/0005-money-as-integer-minor-units.md)
2. **Never trust the client for ownership.** Re-verify every `id` server-side.
3. **Every table has RLS**, with a pgTAP isolation test.
4. **`lib/core` stays pure.** No React, Next, supabase-js, `process.env`, clock.
5. **The canonical fixture passes** for any money-math change.
6. **Docs change in the same PR** as the behaviour they describe.
7. **No secret is ever AI-authored or AI-echoed.**

## Next

- [04-pull-requests.md](04-pull-requests.md) — review order: money math first.
- [07-definition-of-ready-and-done.md](07-definition-of-ready-and-done.md) — the bar every PR clears.
- [`../docs/domain/`](../docs/domain/) — the specifications to implement against.
