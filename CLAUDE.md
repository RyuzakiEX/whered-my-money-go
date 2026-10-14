# CLAUDE.md

Operating instructions for Claude Code in this repository.

**This is a personal-finance app.** A wrong number is worse than a crash,
because it looks like an answer. Two rules follow from that and override
convenience every time: money is never a float, and the client is never
trusted for ownership.

---

## The task workflow

Every task follows three phases. **Do not skip to phase 2.**

### Phase 1 — Plan

Before writing code:

1. **Read the task's acceptance criteria** in `tasks/backlog/m*.md`. The whole
   row, not the title.
2. **Read the docs the task cites.** They exist because the product spec is
   deliberately loose in places and those ambiguities were already resolved —
   see `docs/domain/` for the money math and `docs/architecture/` for
   structure. Re-deciding them in code is how two implementations drift apart.
3. **Check scope and overlap:**
   - Does another task own part of this? (`type:contract` tasks block frontend
     work in the same milestone.)
   - Does this touch a shared module? The occurrence-dedupe module is used by
     both Safe to Spend and the Timeline — changing it affects both.
   - Is this task actually ready, or does it depend on something unmerged?
4. **State the plan**, including anything the acceptance criteria leave
   ambiguous. Ask rather than assume when two readings would produce
   materially different work.

**Deviating from the backlog is allowed** — it was written in advance and the
world moves. But say so explicitly, give the reason, and **update the task's
acceptance criteria in the same PR**, so the doc never contradicts the code.

### Phase 2 — Implement

1. **Branch:** `<type>/<issue-or-task>-<slug>` — e.g.
   `feat/m0-b04-vitest-setup`. Never commit to `main`.
2. **Capture the test baseline BEFORE changing anything:**

   ```bash
   npm run test 2>&1 | tail -5          # record pass/fail/skip
   npm run test:integration 2>&1 | tail -5
   ```

   Write the numbers down. The PR reports baseline against after, and the
   numbers must come from actual runs — **never estimated, never re-run after
   the fact to make them agree.** A pre-existing failure that persists is fine;
   silently hiding one is not.

   *No test runner exists until M0-B04. Until then, state that in the PR table
   rather than inventing numbers.*

3. **Write the failing test first** for anything in `lib/core`. Non-negotiable:
   the domain docs already define correct, so a test written afterwards just
   asserts whatever the code happens to do.
4. **Stay in scope.** If you find unrelated work, file it or note it — do not
   grow the PR. Review quality collapses past ~400 changed lines, and a commit
   doing three things makes `git bisect` useless.
5. **Verify before pushing:**

   ```bash
   npm run verify              # lint, boundaries, markdown, format, types
   npm run test                # unit            [after M0-B04]
   npm run test:integration    # integration     [after M0-B04]
   npm run db:reset                        # schema replays from empty
   npx supabase test db                    # RLS (pgTAP)   [after M1-B03]
   npm audit --audit-level=high --omit=dev
   ```

6. **Check every acceptance criterion** and record PASS / FAIL / PARTIAL with a
   reason. A criterion you chose not to meet is a PARTIAL with an explanation,
   not an omission.

### Phase 3 — Pull request

Use the format in `.github/pull_request_template.md`. It is not optional
structure; each section exists because its absence caused a problem.

The sections that get skipped and should not be:

- **Acceptance Criteria Validation** — derived from the task, marked
  individually. Do not invent results.
- **Test Results** — baseline vs after, with every delta explained, including
  failures unrelated to this work.
- **Test Recipes** — one per AC, with setup / action / expected / negative
  cases. *If a recipe cannot be written, the AC is not ready to ship.*
- **Misalignments** — any conflict between the task, the docs, and reality, and
  how it was resolved.

---

## Non-negotiables

Each is enforced by lint, CI, or a review gate, and each exists because its
absence is how this category of app fails.

| Rule | Why |
|---|---|
| **Money is integer minor units** | `₱1,234.56` is `123456`. Floats drift, and the drift compounds across a transaction history. [ADR-0005](docs/adr/0005-money-as-integer-minor-units.md) |
| **Never trust the client for ownership** | Every `id` re-verified server-side, *even though RLS also enforces it*. RLS answers "may this user touch this row" — not "does this write make sense". |
| **Every table has RLS** | The anon key is public by design. A table without RLS is world-readable to anyone who reads the JS bundle. CI fails the build. |
| **`lib/core` stays pure** | No React, Next, supabase-js, Zod, date libraries, `process.env`, or clock. `today` is always injected. [ADR-0003](docs/adr/0003-pure-typescript-domain-core.md) |
| **Balances are derived** | Never a stored mutable column — it drifts from the ledger, and then every figure built on it is wrong. |
| **Calendar dates, never UTC instants** | The single most common bug class in budgeting apps. [recurrence.md](docs/domain/recurrence.md) |
| **Migrations are forward-only** | A down-migration on financial data deletes records, and it gets run mid-incident under pressure. |
| **Never log an amount with an identity** | A log aggregator is a copy of the database with none of its access controls. |
| **Docs change in the same PR** | A follow-up docs task does not happen. A doc describing behaviour the code lacks is worse than no doc — it gets trusted. |

### The cross-table ownership trap

A policy checking only `user_id = auth.uid()` still lets a user attach *their*
transaction to *someone else's* account. Every predicate passes. The fix is an
`EXISTS` check on the referenced row, and a pgTAP test that specifically
attempts the foreign-key attack — because every other test passes against the
vulnerable policy.

See [rls-policies.md](docs/architecture/rls-policies.md#cross-table-ownership).

---

## Commands

```bash
npm run verify     # lint + boundaries + markdown + format + typecheck
npm run build      # production build
npm run lint:boundaries   # assert the import matrix is still enforced
npm audit --audit-level=high --omit=dev
```

Local equivalents of the CI gates are in
[workflow/08-ci-gates.md](workflow/08-ci-gates.md). **Reproduce a gate locally
rather than pushing to see whether it passes.**

Watch for **version skew** between local tooling and CI: `npx --yes <tool>`
pulls the latest, while a pinned action bundles a specific version, and the
rules differ. That skew has already let a lint error reach the remote. Prefer
the pinned devDependency.

---

## Where things live

| Path | Contents |
|---|---|
| `docs/domain/` | The money algorithms, resolved and testable. **Read before implementing any calculation.** |
| `docs/architecture/` | Structure, data model, RLS, caching, frontend |
| `docs/adr/` | Decisions and the alternatives rejected |
| `workflow/` | Branching, commits, PRs, CI gates, releases |
| `tasks/backlog/` | Every task with acceptance criteria |
| `tasks/milestones.md` | Progress — regenerate with `python scripts/update-progress.py` |

**Naming:** check [glossary.md](docs/product/glossary.md) before naming a
function or column. One name per concept.

---

## Honesty requirements

This matters more here than in most projects, because the output is financial
figures a user will act on.

- **Report what happened, not what should have happened.** If a test fails, say
  so with the output. If a step was skipped, say that.
- **Never fabricate a number.** Not a test count, not a coverage percentage,
  not a SHA. If you do not have it, say you do not have it. A placeholder is
  acceptable only when clearly marked as one.
- **Verify before claiming.** "All gates green" means you looked. A gate that
  is not a required check still deserves a look — CodeQL was red on every
  commit for days because nobody checked a non-blocking gate.
- **A rule nobody has watched fail is a rule nobody should trust.** When adding
  an assertion, prove it catches the thing by deliberately breaking that thing.
  `npm run lint:boundaries` exists for exactly this reason; `M9-B02` applies the
  same standard to the RLS gate.
- **Correct your own errors plainly** and move on. No ceremony.

---

## Current state

Docs and CI are complete. The app is a scaffold: Next.js with strict
TypeScript, enforced import boundaries, no features yet.

Progress is in [tasks/milestones.md](tasks/milestones.md). Next up is M0-B04
(Vitest), which makes the test-baseline step of this workflow executable.
