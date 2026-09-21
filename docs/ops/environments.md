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

| Variable | Local | Preview | Production | Secret? |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | preview project URL | production project URL | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | local fixed demo key | preview anon key | production anon key | No |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Vercel preview URL | canonical domain | No |
| `SUPABASE_SERVICE_ROLE_KEY` | local fixed demo key | preview service key | production service key | **Yes** |
| `SUPABASE_DB_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | preview connection string | production connection string | **Yes** |
| `SUPABASE_PROJECT_ID` | — | preview ref | production ref | No |

`NEXT_PUBLIC_*` variables are compiled into the client bundle and are public
forever. Anything secret must not carry that prefix — see
[../security/security-model.md](../security/security-model.md#public-vs-secret-environment-variables).

The local Supabase stack prints the same fixed anon and service keys for every
developer on earth. They are demo values on a stack that is not
internet-reachable, which is why `.gitleaks.toml` allowlists them.

## Where each secret lives

| Store | Holds | Does **not** hold |
|---|---|---|
| **Vercel** production env | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` | — |
| **Vercel** preview env | Preview project's keys | Production keys |
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

`supabase start` binds:

| Port | Service |
|---|---|
| 54321 | API gateway (PostgREST, Auth, Storage) |
| 54322 | Postgres |
| 54323 | Studio (web UI) |
| 54324 | Inbucket — catches outbound email, so password-reset flows are testable |

Inbucket is how you test the spec §4.1 password-reset flow locally: the email
never leaves your machine, and you read it at `http://localhost:54324`.

## Preview deployments

Every PR gets a preview URL with its own isolated data. This is where milestone
demos happen — a milestone is not done until its demo script passes on a preview
deployment
([../../workflow/07-definition-of-ready-and-done.md](../../workflow/07-definition-of-ready-and-done.md)).

Two properties to preserve:

- **Preview data is disposable and seeded.** Never copy production data into
  preview. A convenient copy of real financial records behind a shareable URL
  with no access control is a disclosure waiting to happen.
- **Preview is publicly reachable.** Anyone with the link can open it, so it
  must contain nothing real.

## Setting up a new environment

Ordered, because the ordering matters:

```text
1. Create the Supabase project (choose the region nearest your users).
2. Apply migrations:            supabase link --project-ref <ref>
                                supabase db push
3. Confirm RLS:                 every public table has RLS enabled.
                                Do not skip. See docs/architecture/rls-policies.md.
4. Set Vercel env vars for that environment.
5. Configure Auth: site URL, redirect allowlist, email templates.
6. Deploy the app.
7. Smoke test: sign up → add an account → add a transaction → check the
   dashboard → verify Safe to Spend computes.
8. Record actual values in this doc's matrix.
```

Step 3 is a manual verification because it is the one whose failure is silent
and total. The `schema-drift` CI gate enforces it on every change, but a
freshly-provisioned project deserves a human check.
