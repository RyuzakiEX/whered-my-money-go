# 0006 — Documentation and CI land before application code

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Deciders** | @jorge |
| **Affects** | The entire initial commit series; `M0` |

## Context

The repository began with one file: a 14 KB product specification and no code,
no commits, no remote.

The specification is rich but deliberately loose in exactly the places that
matter most. Spec §9 gives the Safe to Spend identity and a worked example, but
does not define the horizon, what counts as a spendable balance, or how to avoid
double-counting a bill paid early. Spec §12 asks for a projection without saying
how. Spec §15 lists recurrence frequencies without addressing month-end
clamping.

Those gaps are the interesting engineering, and there are two ways to close
them: decide while writing the code, or decide first and write it down.

The forces:

- **Ambiguity resolved in code is invisible.** A horizon chosen inside a
  function is a decision nobody can review, and nobody will remember.
- **Money math needs a definition of correct before it has an implementation.**
  A test asserting whatever the code returns is not a test.
- **CI added later is CI shaped by the code's existing shortcuts.** A repo
  without a schema-drift gate ships a table without RLS long before anyone adds
  the gate.
- **One developer, and time passes.** Six months on, "why is the horizon
  month-end?" has no answer if it was never written.

## Decision

**Documentation and CI land as the first commits. No application code, no
`package.json`, no migrations, until they are in place.**

Concretely:

1. **`/docs`** — architecture, the resolved domain algorithm specifications,
   security model, ops runbooks, and these ADRs.
2. **`/workflow`** — the development process.
3. **`/tasks`** — the full MVP backlog: 10 milestones, every task with
   acceptance criteria.
4. **`.github`** — issue and PR templates, and all six CI workflows.

**Every CI job is authored now and skips gracefully** until the code it checks
exists. A `preflight` job detects what the repository contains; downstream jobs
gate on its outputs and are **skipped, not failed**. A final aggregate-gate job
(`if: always()`) is the required status check — green when everything passed *or*
skipped, red only on real failure.

Spec `plan.md` moved to `docs/product/product-spec.md` and was reformatted, with
content preserved exactly.

## Consequences

### What this makes easier

- **Every ambiguity is resolved and reviewable.** The horizon is month-end
  because [safe-to-spend.md](../domain/safe-to-spend.md#horizon) argues for it in
  writing. That is a decision someone can disagree with — which is the point.
- **Tests have a specification.** Spec §9's ₱23,500 is a named fixture before
  any code exists, so `computeSafeToSpend` is written against a definition of
  correct rather than producing one.
- **Streams can start in parallel immediately.** The contract-first protocol and
  directory ownership are defined, so M1's frontend and backend tasks are
  simultaneously actionable.
- **CI is green *and* meaningful from commit one.** gitleaks scans full history,
  Trivy's misconfig scanner analyses the workflows themselves, CodeQL's `actions`
  analysis lints them for injection, and the docs gate checks structure and
  links. That is real coverage, not a placeholder.
- **The schema-drift gate exists before the first table.** So no table can ever
  ship without RLS — the check predates the opportunity to violate it.
- **Branch protection never needs editing.** The aggregate gates always run, so
  the required checks are stable as jobs come online.

### What this makes harder

- **Nothing is demoable yet.** The first visible product is further away than it
  would be with a `create-next-app` first commit.
- **Some documentation will be wrong.** Written before implementation, a few
  details will not survive contact with the code. `M9-B07` reconciles docs
  against shipped reality, and `source-structure.md` carries a **PLANNED**
  banner until then.
- **The graceful-skip machinery is real complexity** in the workflows, and it
  has to be explained ([workflow/08-ci-gates.md](../../workflow/08-ci-gates.md))
  so a skipped job is not mistaken for a broken one.
- **Upfront effort before feedback.** A large batch of writing with no running
  code to validate it against.

### What this forecloses

- **Nothing structural.** Docs and CI can be changed at any time. The only cost
  already sunk is the writing.

## Alternatives considered

### Scaffold the app first, document as you go

**What it was.** `create-next-app`, build M1, write docs alongside.

**Why rejected.** "As you go" reliably means "later", and later means never for
the docs nobody is blocked on. More specifically: the Safe to Spend algorithm
would get decided inside a function under time pressure, and the resolutions —
horizon, exclusion flag, dedupe rule — would exist only as code. When the
timeline feature later needed the *same* dedupe rule, it would get a second
implementation, and the two would drift. The shared-module decision in
[money-timeline.md](../domain/money-timeline.md) only exists because both
algorithms were specified before either was written.

### Docs only, add CI when there is code to check

**What it was.** Write `/docs`, `/workflow`, `/tasks`. Add workflows during M0.

**Why rejected.** CI added after the fact is shaped by what the code already
does. The schema-drift gate is the clear case: added during M0, it checks
whatever the first migrations happen to look like. Added first, it *defines*
that every table has RLS and that generated types stay current — and the first
migration is written to satisfy it. The gate is cheap to write now and awkward
to retrofit.

Writing the workflows now also forced the graceful-skip design, which is what
makes the whole approach viable.

### Minimal docs, deep detail during implementation

**What it was.** Outline the architecture; specify each algorithm at the start of
its milestone.

**Why rejected.** Half-reasonable, and close to what a larger team would do. It
fails here on cross-cutting decisions: the dedupe rule is shared by M7 and M8,
the money-unit decision constrains every milestone, and the import matrix
determines the stream split for all of them. Specified per-milestone, those
would be decided by whichever milestone came first, with the others adapting to
an arbitrary choice.

## Revisit when

- `M9-B07` — reconcile every doc against shipped behaviour, drop the PLANNED
  banners, and supersede anything the code contradicted.

## References

- [../../workflow/08-ci-gates.md](../../workflow/08-ci-gates.md) — the graceful-skip and aggregate-gate design
- [../domain/](../domain/) — the resolved algorithm specifications this decision produced
- [../../tasks/milestones.md](../../tasks/milestones.md) — the backlog it produced
- Spec §33 (MVP principle) — the tension this decision sits against, deliberately
