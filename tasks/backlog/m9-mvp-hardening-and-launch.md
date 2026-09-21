# M9 — MVP Hardening & Launch

**Goal.** Ship a product that answers all nine of spec §31's questions and is
safe to put in front of real users' financial data. Everything here is work that
cannot sensibly be done earlier: an audit needs something to audit, a
performance budget needs a full app to measure, and a docs reconciliation needs
the docs to have been contradicted by shipped code.

Two tasks carry the most weight. **[M9-B01](#tasks)** walks every threat in the
security model against the code that now exists — this is the last gate before
real financial data. **[M9-B02](#tasks)** adds a CI check that fails if any new
table lacks RLS, which is the one control that keeps working after this
milestone ends.

## Exit criteria

- [ ] All nine spec §31 questions answerable in the running app
- [ ] Security review complete; every `type:security` p0/p1 closed
- [ ] Every Server Action audited for client-supplied ownership trust
- [ ] RLS coverage audited, and **CI fails if a new table lacks RLS**
- [ ] Accessibility pass across all nine routes; axe clean in CI
- [ ] Every route usable at 360 px with touch targets ≥ 44 px
- [ ] Performance budgets met against the 5,000-transaction seed
- [ ] E2E suite covers the nine questions, under 10 minutes, flake-free over three runs
- [ ] Marketing landing page live
- [ ] Production deployed, smoke-tested, `v1.0.0` tagged
- [ ] Docs match shipped behaviour; `source-structure.md` no longer says "planned"

## Progress

| Done | ID | Title |
|---|---|---|
| [ ] | M9-B01 | `[M9][SH] Complete the security review` |
| [ ] | M9-B02 | `[M9][BE] Audit RLS coverage and add the CI guard` |
| [ ] | M9-B03 | `[M9][SH] Complete the performance pass` |
| [ ] | M9-B04 | `[M9][SH] Add error boundaries and observability` |
| [ ] | M9-F01 | `[M9][FE] Complete the accessibility pass` |
| [ ] | M9-F02 | `[M9][FE] Complete the mobile responsive pass` |
| [ ] | M9-F03 | `[M9][FE] Build the marketing landing page` |
| [ ] | M9-B05 | `[M9][DO] Complete the E2E critical-path suite` |
| [ ] | M9-B06 | `[M9][DO] Write the deploy runbook and ship v1.0.0` |
| [ ] | M9-B07 | `[M9][SH] Reconcile docs and ADRs with shipped behaviour` |

## Tasks

| ID | Stream | Title | Acceptance criteria | Issue |
|---|---|---|---|---|
| M9-B01 | shared | `[M9][SH] Complete the security review` | Every threat T1–T10 in [security-model.md](../../docs/security/security-model.md#threats-and-mitigations) is walked against the shipped code, with the finding recorded per threat — verified, or a filed issue; **the "no client-side ownership trust" audit is performed on every Server Action**: each action accepting an `id` is confirmed to derive `user_id` from the session and to re-verify ownership server-side, with the audit recorded as a table of action name → verified, because RLS alone does not answer whether a write makes product sense per [the three-layer rule](../../docs/security/security-model.md#the-three-layer-rule); every Zod schema is confirmed `.strict()` so unknown keys are rejected rather than ignored, closing the mass-assignment threat; every write is confirmed to use an explicit column allowlist; the `NEXT_PUBLIC_` variable list is audited so no secret carries the prefix; `admin.ts` is confirmed unreachable from `app/` by both lint and a bundle check; auth error messages are confirmed uniform so account existence cannot be probed; all findings filed as `type:security` issues, and **every p0 and p1 closed before launch** | — |
| M9-B02 | backend | `[M9][BE] Audit RLS coverage and add the CI guard` | Every public table is confirmed to have RLS enabled, at least one policy, and a pgTAP isolation test using `assert_user_isolated` from [M1-B03](m1-auth-and-profile.md); every table with a user-owned foreign key is confirmed to enforce **cross-table ownership** in its `WITH CHECK`, with the specific foreign-reference insert test present — the case a plausible-looking policy passes while remaining vulnerable, per [rls-policies.md](../../docs/architecture/rls-policies.md#cross-table-ownership); the audit is recorded as a table of table → RLS → policy count → isolation test → cross-table test; **the `schema-drift.yml` RLS gate is verified to actually fail** by temporarily adding a table without RLS on a scratch branch and confirming a red build, with the evidence in the PR — a gate nobody has seen fail is a gate nobody should trust; the guard's coverage is extended if the audit found a table shape it would have missed; views are confirmed not to bypass RLS, either by inheriting it through the underlying tables or by explicit `security_invoker`, with a pgTAP test per view | — |
| M9-B03 | shared | `[M9][SH] Complete the performance pass` | The budgets in [deployment.md](../../docs/ops/deployment.md#performance-budgets) are measured against the deterministic 5,000-transaction seed from [M4-B04](m4-dashboard-core.md) and met: dashboard TTFB < 600 ms and LCP < 2.5 s, transaction list TTFB < 500 ms, timeline TTFB < 800 ms, initial client JS < 200 KB gzipped; the query plan for every list and aggregate query is captured and confirmed to use an index rather than a sequential scan, with plans attached to the PR; **query counts are asserted constant** for the dashboard, transactions list, budgets, goals, Safe to Spend, and timeline — no N+1 anywhere, each with a test; the Supabase **connection pooler** is confirmed in use for the app while migrations use a direct connection, since connection saturation is the first thing that breaks at scale per [system-architecture.md](../../docs/architecture/system-architecture.md#performance-and-scale); the chart library is confirmed to load only on routes that render a chart; the timeline occurrence cap is confirmed to bound worst-case CPU with a test at the cap; a bundle-size budget is enforced in CI so a regression fails a build rather than being discovered later | — |
| M9-B04 | shared | `[M9][SH] Add error boundaries and observability` | `error.tsx` and `not-found.tsx` per route group, rendering a friendly failure in spec §32's non-judgmental voice and **showing the `requestId`** so a user can quote something that finds the trace; the structured logger from [observability.md](../../docs/architecture/observability.md) is wired with a `requestId` generated in `middleware.ts` and threaded through every request; the typed `LoggableContext` allowlist is in place so **the compiler prevents logging an amount, a description, an email, or a token** — structural redaction rather than a regex denylist, which fails the moment someone nests a field; error tracking is wired with automatic request-body capture **disabled** and a `beforeSend` scrubber, verified by a test that throws a synthetic error carrying an amount and asserts the outbound payload does not contain it; the alert thresholds from [observability.md](../../docs/architecture/observability.md#what-to-alert-on) are configured, including the any-occurrence alert on a cross-user access attempt; `GET /api/health` returns status and release with a trivial database round trip, unauthenticated but revealing nothing, and returns 503 when the check fails | — |
| M9-F01 | frontend | `[M9][FE] Complete the accessibility pass` | All nine spec §25 routes plus the auth and marketing routes are keyboard navigable end to end with a logical tab order and a visible focus indicator everywhere — no `outline: none` without a replacement; AA contrast verified in **both** themes for text, large text, and UI boundaries; every chart carries an accessible fallback table and a summarising `aria-label`, per [frontend-architecture.md](../../docs/architecture/frontend-architecture.md#charts-need-a-text-equivalent); progress bars and rings carry appropriate ARIA roles and values; **the Safe to Spend breakdown is confirmed to be a real `<table>` with headers** and to be navigable by screen reader, since arithmetic read aloud needs structure; no information is conveyed by colour alone anywhere — verified by a greyscale pass over every route; every input has a real `<label>`; error messages are programmatically associated and announced; `prefers-reduced-motion` respected; one `<h1>` and a meaningful heading order per route; landmarks correct; **axe runs clean in CI** and the check is added to the `e2e` gate so a regression fails a build | — |
| M9-F02 | frontend | `[M9][FE] Complete the mobile responsive pass` | Every route verified at **360 px** with no horizontal page scroll — wide content such as tables, charts, and the timeline spine scrolls inside its own container instead; all touch targets ≥ 44 × 44 px; **`+ Add Transaction` is thumb-reachable** on a 360 px viewport, since it is the app's most frequent action and spec §33's principle depends on it being frictionless; the app-shell sidebar collapses to the mobile drawer from [M0-F02](m0-foundation.md) and traps focus while open; the Safe to Spend hero card and its breakdown drawer are legible and operable at 360 px; charts remain readable or degrade to their fallback table; dialogs and sheets are full-height on mobile with a reachable close control; long account, category, and goal names truncate gracefully rather than breaking layout; verified at 360, 390, and 768 px in both themes | — |
| M9-F03 | frontend | `[M9][FE] Build the marketing landing page` | `(marketing)/page.tsx` leads with spec §1's positioning — the app answers where your money goes and **how much is actually safe to spend** — using spec §1's own contrast between *"You spent ₱35,000 this month"* and *"You have ₱12,400 that's actually safe to spend"*, since that contrast is the product's entire pitch; the **Safe to Spend hook** is the primary above-the-fold message, with the Money Timeline second, matching spec §29's differentiator ordering; copy in spec §32's playful, non-judgmental voice, drawing on the spec's own example lines; a clear sign-up CTA linking to `(auth)/sign-up`; no fabricated testimonials, no invented user counts, and no screenshots showing anyone's real financial data — illustrative figures only, drawn from the demo seed; fast — this is the first page a visitor loads, so it stays within the LCP budget and ships minimal client JS; accessible and responsive to the same bar as the app | — |
| M9-B05 | devops | `[M9][DO] Complete the E2E critical-path suite` | **Each of spec §31's nine questions is covered by an explicit assertion**, with the mapping recorded in [success-criteria.md](../../docs/product/success-criteria.md) — Q1 accounts, Q2/Q3/Q4 dashboard, Q5 Safe to Spend, Q6 timeline, Q7 budgets, Q8/Q9 goals; the suite runs against the deterministic [M4-B04](m4-dashboard-core.md) seed so assertions are on exact figures rather than ranges; **the whole suite completes in under 10 minutes** and is **flake-free over three consecutive runs**, with the three runs' results recorded in the PR — a flaky suite gets ignored, and an ignored suite is worse than none because it provides false confidence while consuming CI minutes; a failing run uploads the Playwright trace artifact; the suite is confirmed to gate on `e2e` and, once the suite is proven stable, `e2e` is added to branch protection's required checks with the change recorded in [02-branching.md](../../workflow/02-branching.md) | — |
| M9-B06 | devops | `[M9][DO] Write the deploy runbook and ship v1.0.0` | The production Supabase project is provisioned in a region near the users; migrations applied with `supabase db push`; **RLS manually verified on every table** — manual despite the CI gate, because a freshly provisioned project has never been through it and a missing policy means every user's financial data is readable by anyone who reads the client bundle; reference data seeded and **no demo data**, since seeding fabricated transactions into production would put false financial records in real users' accounts; Auth configured with the site URL, redirect allowlist, and email templates; Vercel production env vars set with the `service_role` key present **only** in the production environment and **never** as a GitHub Actions secret; custom domain with HTTPS; the app deployed; the **full seven-step smoke test** from [10-release.md](../../workflow/10-release.md#smoke-test) passed, with step 6 — Safe to Spend recomputing — as the real check that most of the stack works; error tracking and alerts confirmed live; `v1.0.0` tagged with a generated changelog; [deployment.md](../../docs/ops/deployment.md) and [environments.md](../../docs/ops/environments.md) updated with the actual values rather than placeholders | — |
| M9-B07 | shared | `[M9][SH] Reconcile docs and ADRs with shipped behaviour` | Every document in `/docs` is read against the shipped code and corrected where they disagree — **a doc confidently describing behaviour the code does not have is worse than no doc, because it will be trusted**; the **PLANNED** banner is removed from [source-structure.md](../../docs/architecture/source-structure.md) and its tree and import matrix updated to what actually exists; [data-model.md](../../docs/architecture/data-model.md) is verified column-by-column against the migrations; the cache [invalidation matrix](../../docs/architecture/state-and-caching.md#invalidation-matrix) is verified against the revalidation helpers, which already have a test asserting agreement; each domain doc's canonical fixture is confirmed to exist as a passing test with the documented name; **new ADRs are written for decisions made implicitly during M1–M8**, including the candidate ADR-0007 on derived account balances that [data-model.md](../../docs/architecture/data-model.md) flagged; any ADR the shipped code contradicts is marked **Superseded** by a new one rather than edited, since the value of the directory is its history per [adr/README.md](../../docs/adr/README.md); [ADR-0006](../../docs/adr/0006-docs-ci-first-scaffold.md)'s "revisit when" condition is discharged by this task | — |

## Demo script

The M9 demo is the whole product. Run on production after
[M9-B06](#tasks), answering spec §31's nine questions in order:

1. **How much money do I have?** — Accounts page, then the dashboard tile.
2. **How much did I earn this month?** — dashboard, zero clicks.
3. **How much did I spend?** — same.
4. **Where did my money go?** — the spending breakdown; click through to a
   filtered list.
5. **How much can I safely spend?** — the Safe to Spend card; open the
   breakdown; walk the five terms.
6. **What bills are coming up?** — the timeline; show the projected balance and
   any shortfall.
7. **Am I staying within my budget?** — the budget page and the dashboard
   warning widget.
8. **How much have I saved?** — the goals page.
9. **Am I on track?** — the projected completion dates.

Then: navigate the whole app by keyboard only, and repeat at 360 px.

## Notes

- **[M9-B01](#tasks) and [M9-B02](#tasks) are the launch gates.** Everything
  else improves the product; those two are what make it safe to hold real
  financial data.
- **[M9-B02](#tasks) verifies the gate actually fails.** A CI check nobody has
  watched fail is a check nobody should trust — deliberately adding a table
  without RLS on a scratch branch is the only way to know.
- **[M9-B07](#tasks) is not paperwork.** The docs were written before the code
  ([ADR-0006](../../docs/adr/0006-docs-ci-first-scaffold.md)), so some of them
  are wrong by now. Leaving a confidently-wrong document in place is the failure
  mode this task exists to prevent.
- **The E2E flake bar is a hard requirement**, not a target. Three clean
  consecutive runs, recorded.
- Spec §33's real test — *"Ohhh. Now I know where my money is going."* — is not
  checkable. It is worth asking someone anyway.
