---
description: Work a backlog task through plan → implement → PR
argument-hint: <task-id> (e.g. M0-B04)
---

Work task **$1** through the three-phase workflow in
[CLAUDE.md](../../CLAUDE.md). Do not skip to implementation.

## Phase 1 — Plan

1. Read the **full acceptance-criteria row** for $1 in `tasks/backlog/`, not
   just the title.
2. Read every doc the task cites. The money algorithms are already resolved in
   `docs/domain/` — implement the specification, do not re-derive it.
3. Check scope and overlap:
   - Does a `type:contract` task block this?
   - Does it touch a module shared by other features (the occurrence-dedupe
     module serves both Safe to Spend and the Timeline)?
   - Are its dependencies merged?
4. **State the plan and stop.** Flag anything ambiguous in the criteria, and
   ask when two readings would produce materially different work.

## Phase 2 — Implement

1. Branch: `<type>/<task-id-lowercase>-<slug>`.
2. **Capture the test baseline first**, before changing anything. Record the
   actual pass/fail/skip counts — the PR reports baseline against after, and
   estimating defeats the point. *(No suite until M0-B04; say so rather than
   inventing numbers.)*
3. Failing test first for anything in `lib/core`.
4. Implement **only** this task. Found something else? File or note it — do not
   grow the PR.
5. Verify: `npm run verify`, the test suites, schema and RLS checks where the
   task touches `supabase/**`, and `npm audit`.
6. Mark every acceptance criterion PASS / FAIL / PARTIAL with a reason.

## Phase 3 — Pull request

Fill in `.github/pull_request_template.md` completely. The sections that get
skipped and must not be:

- **Acceptance criteria validation** — each one marked, no invented results
- **Test results** — baseline vs after, every delta explained
- **Test recipes** — one per AC, with negative cases. If a recipe cannot be
  written, the AC is not ready to ship
- **Misalignments** — conflicts found, and how they were resolved

Then update progress:

```bash
# tick the task in tasks/backlog/m*.md, then
python scripts/update-progress.py
```

## Throughout

Report what actually happened. Do not fabricate a test count, a coverage
figure, or a SHA. If a gate is red, say so with the output. If you add an
assertion, prove it catches the thing by deliberately breaking that thing.
