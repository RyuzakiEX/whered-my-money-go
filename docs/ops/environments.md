# Environments

**Shape in one sentence:** three environments, each with its own Supabase
project, because a preview deployment sharing production's database is one bad
migration away from destroying real users' financial records.

Related: [deployment.md](deployment.md),
[database-migrations.md](database-migrations.md),
[../security/security-model.md](../security/security-model.md#secrets-inventory),
[../../workflow/01-local-setup.md](../../workflow/01-local-setup.md).

## The three environments

| | Local | Preview | Production |
|---|---|---|---|
| **App** | `next dev` on localhost | Vercel preview per PR | Vercel production |
| **Database** | Local Supabase (Docker) | Supabase preview project | Supabase production project |
| **Data** | Seeded fixtures | Seeded fixtures | **Real user data** |
| **Migrations applied** | `supabase db reset` (destructive, freely) | On deploy | Deliberately, before app deploy |
| **Destructive resets** | Constantly | Allowed | **Never** |
| **Who can reach it** | You | Anyone with the PR link | The public |

> [!IMPORTANT]
> **A separate Supabase project per environment is non-negotiable.** Sharing one
> is the mistake that ends a project: a `supabase db reset` aimed at what you
> thought was preview drops production's tables, and financial data has no
> undo. Separate projects make that impossible rather than merely discouraged.

## Environment variable matrix

What the **app** reads, per environment. Local is `.env.local`; Preview and
Production are Vercel environment scopes.

| Variable | Local (`.env.local`) | Preview (Vercel) | Production (Vercel) | Secret? |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | `https://qvqamjyjjcnvjsflvrsb.supabase.co` | `https://xseokwrfhpsdhvxwhfzd.supabase.co` | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | local fixed demo key | preview project's anon key | production project's anon key | No |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | *unset — `VERCEL_URL` is used* | *unset — `VERCEL_URL` is used* | No |
| `SUPABASE_SERVICE_ROLE_KEY` | local fixed demo key | **never set** | **never set** | **Yes** |
| `SUPABASE_DB_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | **never set** | **never set** | **Yes** |

The Vercel **Development** scope is deliberately empty. `vercel env pull`
writes `.env.local`, and would overwrite the local stack's keys with whatever
the scope holds; local values come from `npx supabase status` instead.

**The `service_role` key is absent from every Vercel scope** (M0-B10), because
nothing the app runs at request time may bypass RLS. `admin.ts` is
lint-restricted to migration tooling and seed scripts, which run locally or in
CI — never in a deployed function. If a request-path feature seems to need it,
the RLS policy is wrong ([api-and-data-access.md](../architecture/api-and-data-access.md)).
`SUPABASE_DB_URL` is likewise a migration-tooling credential and stays out of
Vercel. Verify with the variable names only, never the values:

```bash
curl -sS "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | jq -r '.envs[] | "\(.key)\t\(.target | join(","))"'
```

The expected output is exactly two variables per hosted scope:
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, once for
`preview` and once for `production`, each naming its own project — and nothing
else (no `service_role`, no `SUPABASE_DB_URL`). Recorded 2026-10-31.

**A Vercel build fails without them** (`next.config.ts`, via
`lib/utils/build-env.ts`). On 2026-10-31 production deployed "successfully"
with an empty Production scope and answered 500 on every page: `proxy.ts`
needs these on every request, and `NEXT_PUBLIC_*` values are baked in at
build time. A failed build leaves the last good deployment live instead.

`NEXT_PUBLIC_*` variables are compiled into the client bundle and are public
forever. Anything secret must not carry that prefix — see
[../security/security-model.md](../security/security-model.md#public-vs-secret-environment-variables).

### Supabase projects

| Environment | Project | Ref | Region | Created |
|---|---|---|---|---|
| Preview | `whered-my-money-go-preview` | `qvqamjyjjcnvjsflvrsb` | `ap-southeast-1` (Singapore) | M0-B10 |
| Production | `whered-my-money-go-prod` | `xseokwrfhpsdhvxwhfzd` | `ap-southeast-1` (Singapore) | 2026-10-31, ahead of M9-B06, after production 500'd without a backend |

Both use the free tier, which allows two active projects per organization —
exactly one per hosted environment. Neither database password is stored in the
repository or in Vercel; they live with the maintainer.

**The checkout is linked to preview.** `npx supabase db push --linked` targets
preview. To migrate production, link it deliberately, push, verify RLS, and
link back:

```bash
npx supabase link --project-ref xseokwrfhpsdhvxwhfzd   # production
npx supabase db push --linked --dry-run                # read the list first
npx supabase db push --linked
npx supabase link --project-ref qvqamjyjjcnvjsflvrsb   # back to preview
```

**Production Auth** (set 2026-10-31): site URL and redirect allowlist are the
production URL only; password minimum 8 with letters and digits; recent login
required to change a password. **Email confirmation is ON** (Supabase's
default) — with the built-in mailer, that means only the project's team can
finish signing up. Turning it off, as on preview, is the maintainer's call.

The local Supabase stack prints the same fixed anon and service keys for every
developer on earth. They are demo values on a stack that is not
internet-reachable, which is why `.gitleaks.toml` allowlists them.

## Where each secret lives

| Store | Holds | Does **not** hold |
|---|---|---|
| **Vercel** production env | Production project's URL and anon key (from M9-B06) | **Any** `service_role` key; `SUPABASE_DB_URL` |
| **Vercel** preview env | Preview project's URL and anon key | Production values; **any** `service_role` key; `SUPABASE_DB_URL` |
| **Vercel** development env | Nothing — see above | — |
| **GitHub Actions secrets** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (release jobs only) | **Never** the production `service_role` key |
| **GitHub Actions variables** | `SUPABASE_PROJECT_ID`, build-time placeholder public values | Any secret |
| **`.env.local`** (gitignored) | Local values | — |

Two rules that follow:

- **The production `service_role` key is never a GitHub Actions secret.** CI has
  no legitimate need to bypass RLS on production data, and a workflow with that
  key is a single injection away from total data access.
- **No CI gate requires a secret.** Fork PRs receive none, so a gate that needed
  one would fail on every external contribution. The schema drift gate runs a
  throwaway local Postgres for exactly this reason.

Production-touching jobs use **GitHub Environments** with required reviewers, so
a deploy is an approved action rather than a side effect of a merge.

## Local ports

`npx supabase start` binds (set in the committed `supabase/config.toml`; full
table and key commands in
[../../workflow/01-local-setup.md](../../workflow/01-local-setup.md#local-supabase-ports)):

| Port | Service |
|---|---|
| 54321 | API gateway (PostgREST, Auth, Storage) |
| 54322 | Postgres |
| 54323 | Studio (web UI) |
| 54324 | Mailpit — catches outbound email, so password-reset flows are testable |

Mailpit (formerly Inbucket in older Supabase CLIs) is how you test the spec
§4.1 password-reset flow locally: the email never leaves your machine, and you
read it at `http://127.0.0.1:54324`.

## Preview deployments

Every PR gets a preview URL with its own isolated data. This is where milestone
demos happen — a milestone is not done until its demo script passes on a preview
deployment
([../../workflow/07-definition-of-ready-and-done.md](../../workflow/07-definition-of-ready-and-done.md)).

Two properties to preserve:

- **Preview data is disposable and seeded.** Never copy production data into
  preview. A convenient copy of real financial records behind a shareable URL
  with no access control is a disclosure waiting to happen.
- **Preview must contain nothing real.** Vercel Authentication currently gates
  every `*.vercel.app` deployment to signed-in team members
  ([deployment.md](deployment.md#deployment-protection)), but that is a
  setting one click from off. Treat preview as reachable by anyone with the
  link.

## Setting up a new environment

Ordered, because the ordering matters:

```text
1. Create the Supabase project (choose the region nearest your users).
2. Apply migrations:            npx supabase link --project-ref <ref>
                                npx supabase db push --linked
                                (pass --linked explicitly: the CLI warns that
                                db push will target the LOCAL database by
                                default in its next major version)
3. Confirm RLS:                 every public table has RLS enabled.
                                Do not skip. See docs/architecture/rls-policies.md.
4. Set Vercel env vars for that environment's scope only. URL and anon key;
   never the service_role key. Verify with the name-only listing above.
5. Configure Auth: site URL, redirect allowlist, email templates, and the
   password rule — minimum length 8, "letters and digits" — to match
   supabase/config.toml and lib/validation/auth.ts. The anon key is public, so
   Auth must refuse a weak password itself; the form's schema is bypassable.
   Preview, set 2026-10-30 (M1-B05) through the Management API:
   `site_url` = the production URL; redirect allowlist =
   `https://*-jorges-projects-bfadb832.vercel.app/**` and the production URL;
   password minimum 8, letters and digits. **Email confirmation is OFF** on
   preview (the maintainer's decision, 2026-10-31), matching the local stack:
   Supabase's built-in mailer delivers only to the project's own team members,
   at 2 per hour, so with confirmation on no visitor could finish signing up.
   Consequence: password-reset emails on preview still reach only the team.
   Real email for everyone needs a verified domain on a provider such as
   Resend — Resend's `onboarding@resend.dev` test sender has the same
   own-address-only limit. Production decides separately, at M9-B06.
6. Deploy the app.
7. Smoke test: sign up → add an account → add a transaction → check the
   dashboard → verify Safe to Spend computes.
8. Record actual values in this doc's matrix.
```

Step 3 is a manual verification because it is the one whose failure is silent
and total. The `schema-drift` CI gate enforces it on every change, but a
freshly-provisioned project deserves a human check.
