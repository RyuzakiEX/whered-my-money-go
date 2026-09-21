# Task issue template

A copy-paste skeleton mirroring
[`.github/ISSUE_TEMPLATE/01-task.yml`](../../.github/ISSUE_TEMPLATE/01-task.yml).

Prefer the GitHub form — it enforces the required fields. Use this when filing
in bulk, drafting offline, or pasting a task straight out of a
[backlog file](../backlog/).

---

## Title

```text
[M7][BE] Implement computeSafeToSpend in lib/core
```

`[M<milestone>][<stream>] <verb> <object>`. Stream codes: `FE` frontend ·
`BE` backend · `SH` shared · `DO` devops.

Milestone and stream up front so any list view is readable without opening
issues.

## Labels

One from each dimension, plus the GitHub Milestone (a real milestone, not a
label):

```text
stream:backend
type:task
area:sts
priority:p1
status:ready
```

Full taxonomy: [`../labels.md`](../labels.md).

## Body

```markdown
### Context — why does this exist?

Spec §9 requires a Safe to Spend figure the user can drill into. The algorithm
is fully specified in `docs/domain/safe-to-spend.md`, including the horizon,
the dedupe rule, and the status bands.

### Acceptance criteria

- [ ] `computeSafeToSpend(input): SafeToSpendResult` is pure — `today` injected,
      no clock, no env, no I/O
- [ ] Returns the total **plus** each of the five terms with its contributing
      items, ordered as spec §9's arithmetic layout
- [ ] `STS_FIXTURE_SPEC_S9` asserts exactly `2_350_000` (₱23,500)
- [ ] The companion fixtures in the domain doc all pass
- [ ] Coverage on `lib/core/safe-to-spend/**` ≥ 95%

### Implementation notes

Files: `lib/core/safe-to-spend/{compute,bands,types}.ts`
Spec: `docs/domain/safe-to-spend.md`
Dedupe module is shared with M8 — import it, do not reimplement.

### Depends on

#38 (M6-B05, PlannedSavings), #31 (M3-B05, transaction domain types)

### Definition of Ready

- [x] Title is `[M#][XX] <verb> <object>`
- [x] Acceptance criteria are specific and verifiable
- [x] Dependencies linked, and done or in flight
- [x] Small enough for a single pull request
- [x] Contract exists (frontend tasks needing data only)
```

---

## Writing acceptance criteria

The one thing worth getting right. Criteria that cannot be checked are why
tasks stall — the implementer ends up making a specification decision under
time pressure, unreviewed.

| Not ready | Ready |
|---|---|
| "Safe to Spend works" | "Spec §9's example returns exactly ₱23,500; the terms sum to the total; coverage ≥ 95%" |
| "Add RLS" | "Four `*_own` policies; a pgTAP test asserts user B sees zero of user A's rows and that a cross-user insert fails" |
| "Make it fast" | "Dashboard TTFB < 600 ms against the 5,000-transaction seed; the query plan shows no sequential scan" |

The test: **could someone who did not write this check it?**

## Filing a backlog task

1. Open the milestone's file in [`../backlog/`](../backlog/).
2. Copy the row's title and acceptance criteria — the criteria are written to
   this standard already; split the semicolon-separated clauses into checkboxes.
3. File via the [GitHub form](../../.github/ISSUE_TEMPLATE/01-task.yml).
4. Set the real GitHub Milestone during triage — issue forms cannot set it.
5. **Record the issue number back into the backlog file's `Issue` column**, so
   the docs and GitHub stay cross-referenced.

## Other templates

| Template | Use |
|---|---|
| [`01-task.yml`](../../.github/ISSUE_TEMPLATE/01-task.yml) | Implementation work |
| [`02-bug.yml`](../../.github/ISSUE_TEMPLATE/02-bug.yml) | A defect. Money-math and data-loss checkboxes trigger p0 triage |
| [`03-chore.yml`](../../.github/ISSUE_TEMPLATE/03-chore.yml) | Maintenance, dependencies, config |
| [`04-spike.yml`](../../.github/ISSUE_TEMPLATE/04-spike.yml) | Timeboxed research. **Never merges production code** |

Security vulnerabilities do **not** go in an issue — see
[`../../SECURITY.md`](../../SECURITY.md).
