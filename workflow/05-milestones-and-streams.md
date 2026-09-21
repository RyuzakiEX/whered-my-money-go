# Milestones and Streams

**Milestone = a vertical, demoable slice. Stream = a label, not a team.**

The test for a milestone: *can I show this to a user and have them do something
end to end?* If not, it is a phase, not a milestone — and phases are how a
project spends four months with nothing to show.

## Why vertical slices

The alternative is tempting: build all the schema, then all the backend, then
all the UI. It is rejected here.

| Vertical slices | Horizontal phases |
|---|---|
| M2 ships → you can create accounts and see balances | "Backend done" ships → nothing is usable |
| Integration problems surface in M2 | Surface in month three, all at once |
| Every milestone is demoable on a preview URL | First demo is late and large |
| Scope can be cut after any milestone | Cutting scope mid-phase leaves half a layer |
| Spec §33's principle is testable continuously | Testable at the end |

The ten MVP milestones ([`../tasks/milestones.md`](../tasks/milestones.md)) are
each a slice through schema → RLS → queries → actions → UI → E2E test.

**M0 is the exception** — foundation and toolchain, with nothing user-facing. It
earns that exception because it is the milestone that makes the lint boundary,
the CI gates, and the type generation real; every later milestone depends on
them existing.

## Streams

Four labels, applied to tasks *within* a milestone:

| Stream | Owns | Directories |
|---|---|---|
| `stream:frontend` | Pages, components, UI | `app/**`, `components/**` |
| `stream:backend` | Schema, domain math, data access | `lib/core/**`, `lib/server/**`, `supabase/**` |
| `stream:shared` | Contracts, types, validation | `lib/validation/**`, `lib/utils/**` |
| `stream:devops` | CI, deploy, E2E | `.github/**`, `tests/e2e/**` |

**They are labels, not people.** On a solo project both streams are you —
switching between them is switching context, and the label tells you which
context a task needs. With a second developer the same labels partition work
with no process change.

The reason this works at all is **directory ownership**: the stream boundaries
in
[`../docs/architecture/source-structure.md`](../docs/architecture/source-structure.md#stream-ownership)
are disjoint, so two branches off `main` in the same milestone edit different
files and cannot conflict.

## The contract-first protocol

The substance of this document. It is what lets frontend and backend work the
same milestone simultaneously without one waiting on the other.

```text
        ┌─────────────────────────────────────────────────────┐
  ①     │  CONTRACT TASK  (stream:backend, type:contract)     │
        │  migration + database.types.ts + Zod + domain types │
        │  BLOCKS the milestone's frontend tasks              │
        └────────────────────────┬────────────────────────────┘
                                 │ merged to main
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
  ②   ┌──────────────────────┐        ③   ┌──────────────────────┐
      │  FRONTEND            │            │  BACKEND             │
      │  builds against the  │            │  implements queries  │
      │  real types, with    │            │  and Server Actions  │
      │  fixture data        │            │  against the schema  │
      └──────────┬───────────┘            └───────────┬──────────┘
                 └──────────────┬─────────────────────┘
                                ▼
  ④                  ┌──────────────────────┐
                     │  INTEGRATION TASK    │
                     │  wires them together │
                     │  owns the E2E test   │
                     └──────────────────────┘
```

### ① The contract lands first

One small `type:contract` task per milestone, on the backend stream, delivering:

1. The migration.
2. The regenerated `types/database.types.ts`.
3. The Zod schemas in `lib/validation`.
4. The domain types in `lib/core/types.ts`.

It is deliberately small — schema and types, no queries, no UI — so it merges
fast. Every frontend task in that milestone lists it under **Depends on**.

### ② Frontend builds against types, not queries

Once the contract merges, frontend has real TypeScript types and real validation
schemas. It builds pages and components against **fixture data** shaped by those
types.

The point: the frontend does not wait for the query layer. A component rendering
`Account[]` does not care whether the array came from Postgres or a factory.

### ③ Backend implements in parallel

Queries, mappers, and Server Actions against the schema the contract created.
Different directories, no conflicts.

### ④ Integration wires it up

Usually the E2E task. Replaces fixtures with real queries and asserts the flow
end to end.

## Why not a shared milestone branch

Because the protocol above already provides what a shared branch would:
agreement on the interface. Add a long-lived integration branch and you get
divergence from `main`, a painful periodic merge, and delayed CI feedback — for
no benefit.

See [02-branching.md](02-branching.md) for the full reasoning.

## The handoff artefact

**The merged types and schemas are the handoff.** Not a document, not a
conversation.

That matters because it is *checkable*: if the frontend builds and typechecks
against `lib/validation` and `lib/core/types.ts`, it agrees with what the
backend built. A mismatch is a compile error, not a runtime surprise found in
integration.

Both tasks reference the contract task's issue number, so the dependency is
visible in GitHub rather than remembered.

## Dependency graph

```text
M0 ──▶ M1 ──▶ M2 ──▶ M3 ──┬──▶ M4 ──┐
                          ├──▶ M5 ──┤
                          ├──▶ M6 ──┴──▶ M7 ──▶ M9
                          └──▶ M8 ──────────────┘
```

Two things worth noticing:

- **M4, M5, M6 are independent** once M3 lands. Dashboard, budgets, and goals
  touch different features.
- **M8 does not depend on M7.** The Money Timeline needs accounts and
  transactions, not Safe to Spend. So the two ⭐ differentiators are
  parallelizable — and if only one can ship, that is a real choice rather than a
  forced sequence.

M7 depends on M2, M3, M5, and M6 because its `PlannedSavings` term comes from
goals and its horizon from the budget period.

## Milestone exit

A milestone is done when:

- [ ] Every task closed
- [ ] **The demo script in the milestone doc passes on a preview deployment**
- [ ] The spec §31 questions that milestone covers are answerable in the running app
- [ ] Docs and ADRs current
- [ ] a11y and 360 px mobile pass for frontend slices
- [ ] No open `priority:p0` or `p1` bugs against the slice

The demo requirement is the one that keeps "vertical slice" honest. Passing on a
**preview deployment** — not localhost — proves it works somewhere other than
the machine it was built on. Full criteria:
[07-definition-of-ready-and-done.md](07-definition-of-ready-and-done.md#definition-of-done--milestone).

## Next

- [`../tasks/milestones.md`](../tasks/milestones.md) — the ten milestones with exit criteria.
- [06-task-lifecycle.md](06-task-lifecycle.md) — working a single task.
- [`../docs/architecture/source-structure.md`](../docs/architecture/source-structure.md#stream-ownership) — the directory ownership this depends on.
