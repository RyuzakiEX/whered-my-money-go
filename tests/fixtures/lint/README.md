# Lint boundary fixtures

**These files are deliberately broken.** Each violates one row of the import
matrix in
[source-structure.md](../../../docs/architecture/source-structure.md#import-rules),
and each **must fail** `eslint`.

## Why they exist

A lint rule nobody has watched fail is a lint rule nobody should trust. A typo
in a glob, a plugin that stops loading, a config refactor that drops a block —
all of these silently disable the boundary, and the first sign would be
`lib/core` quietly importing React months later.

So `npm run lint:boundaries` asserts a **non-zero exit** on these files. If the
rules stop working, that command starts passing, and CI fails.

This is the same reasoning as
[M9-B02](../../../tasks/backlog/m9-mvp-hardening-and-launch.md), which verifies
the RLS gate by deliberately adding a table without policies.

## The fixtures

| File | Violates | Rule |
|---|---|---|
| `core-imports-react.ts` | `lib/core` importing React | Row 1 |
| `core-reads-clock.ts` | `lib/core` reading `Date.now()` / `process.env` | Row 1 |
| `component-imports-server.tsx` | `components/**` importing `lib/server` | Row 6 |
| `app-imports-admin.ts` | `app/**` importing the `service_role` client | Row 5 |
| `component-imports-chart.tsx` | charting library outside `components/charts` | Row 8 |

## Rules

- **Never fix a fixture.** Failing is the point.
- **Never import them** from real code.
- They are excluded from the normal `npm run lint` run (via `ignores` in
  `eslint.config.mjs`) so they do not fail the ordinary lint. They are linted
  only by `npm run lint:boundaries`, with the exit code inverted.
- Adding a row to the import matrix means adding a fixture here.
