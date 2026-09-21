# Architecture Decision Records

**What this is:** a numbered, append-only log of decisions that were expensive
to make and would be expensive to reverse — recorded with the reasoning and the
alternatives, so the next person (usually future-you) can tell a deliberate
choice from an accident.

## Index

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-single-nextjs-app-not-monorepo.md) | Single Next.js app, not a monorepo | Accepted | 2026-09-09 |
| [0002](0002-supabase-cli-migrations-as-schema-source-of-truth.md) | Supabase CLI migrations are the schema source of truth | Accepted | 2026-09-09 |
| [0003](0003-pure-typescript-domain-core.md) | Domain logic is pure, dependency-free TypeScript | Accepted | 2026-09-09 |
| [0004](0004-testing-stack-vitest-playwright.md) | Vitest for unit and integration, Playwright for E2E | Accepted | 2026-09-09 |
| [0005](0005-money-as-integer-minor-units.md) | Money is stored and computed as integer minor units | Accepted | 2026-09-09 |
| [0006](0006-docs-ci-first-scaffold.md) | Documentation and CI land before application code | Accepted | 2026-09-09 |

Candidate, not yet written:

| # | Decision | Status |
|---|---|---|
| 0007 | Account balances derived from transactions rather than stored | Proposed — reasoning in [../architecture/data-model.md](../architecture/data-model.md) |

## When to write one

Write an ADR when a decision is **structural** — it constrains later choices —
**and** reversing it would cost real work.

Good candidates:

- Choosing or dropping a major dependency
- A data-modelling decision that propagates (money representation, derived vs stored)
- An architectural boundary (what may import what)
- A security posture (RLS as the isolation mechanism)
- Deliberately *not* doing something an outside reader would expect

Not ADRs: library version bumps, naming conventions, anything a code comment or
a `docs/` page already covers, and decisions that are cheap to change later.

The test: *if someone asked "why is it like this?" in six months, would the code
alone answer them?* If not, it is an ADR.

## Process

1. Copy [`template.md`](template.md) to `NNNN-kebab-case-title.md`, taking the
   next free number. Numbers are never reused.
2. Fill in **Context**, **Decision**, **Consequences**, and — most importantly —
   **Alternatives considered**, including why each was rejected.
3. Add a row to the index above. CI fails if an ADR is missing from it
   (`docs.yml` → *docs structure checks*).
4. Open the PR with the change the ADR justifies, where practical. An ADR
   defending code nobody has written is a proposal, not a record.

## Status values

| Status | Meaning |
|---|---|
| **Proposed** | Written, not yet agreed |
| **Accepted** | In force |
| **Superseded** | Replaced — links forward to the ADR that replaced it |
| **Deprecated** | No longer applies, nothing replaced it |

> [!IMPORTANT]
> **ADRs are append-only.** Never edit an accepted ADR to reflect a new
> decision, and never delete one. Write a new ADR that supersedes it, and add a
> "Superseded by #NNNN" line to the old one.
>
> The value of this directory is the *history* — knowing that a monorepo was
> considered and rejected, and on what grounds, is more useful than a tidy file
> claiming a monorepo was never on the table. Editing history destroys exactly
> the information the record exists to preserve.

## Reversing a decision

Entirely allowed, and expected as the project learns. The procedure:

1. Write the new ADR. State what changed — new information, new constraint, the
   original reasoning turning out to be wrong.
2. Mark the old one **Superseded by #NNNN**.
3. Reference both from any doc affected.

`M9-B07` reconciles this directory against shipped reality at the end of the
MVP: decisions made implicitly during M1–M8 get written up, and anything
contradicted by the code gets superseded.
