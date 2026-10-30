# Security Model

**Shape in one sentence:** every financial row belongs to exactly one user, and
three independent mechanisms enforce that — server-derived identity, explicit
ownership re-checks, and Row Level Security — because the cost of one failing
alone is a user reading someone else's finances.

Spec §24 sets the requirements. This document is the threat model behind them.

Related: [../architecture/rls-policies.md](../architecture/rls-policies.md),
[../architecture/api-and-data-access.md](../architecture/api-and-data-access.md),
[../architecture/system-architecture.md](../architecture/system-architecture.md#trust-boundaries),
[../architecture/observability.md](../architecture/observability.md),
[ci-security-gates.md](ci-security-gates.md),
[../../SECURITY.md](../../SECURITY.md).

## Contents

- [Assets](#assets)
- [The three-layer rule](#the-three-layer-rule)
- [Threats and mitigations](#threats-and-mitigations)
- [Public vs secret environment variables](#public-vs-secret-environment-variables)
- [Secrets inventory](#secrets-inventory)
- [Code review gates](#code-review-gates)
- [Out of scope](#out-of-scope)

## Assets

What an attacker wants, in priority order:

| Asset | Impact if disclosed | Impact if modified |
|---|---|---|
| **Transaction history** | Reveals income, habits, health, relationships, location patterns | Corrupts every derived figure |
| **Account balances** | Net worth disclosure; enables targeted fraud | User makes decisions on false data |
| **Identity (email, name)** | PII; enables phishing that references real transactions | Account takeover |
| **Session tokens** | Full account access | — |
| **`service_role` key** | **Total loss of isolation across all users** | Arbitrary write to any row |
| **Savings goals** | Reveals plans and financial capacity | Wrong projections |

Financial history is more sensitive than most people assume. It reveals a
medical condition from a clinic payment, a job change from a salary shift, a
relationship from shared expenses. "It's only spending data" is the wrong frame.

## The three-layer rule

Every data access passes three independent checks. This is not redundancy for
its own sake — each catches a different class of failure.

```text
Layer 1  IDENTITY      userId comes from the session. Never from input.
             ↓         Catches: forged user_id in a request payload.

Layer 2  OWNERSHIP     The action re-verifies every incoming id belongs
             ↓         to this user, before writing.
                       Catches: attaching your row to someone else's
                       account; existence probing via error differences.

Layer 3  RLS           Postgres refuses the row regardless of what the
                       application believed.
                       Catches: a bug in layers 1-2. The last line.
```

> [!IMPORTANT]
> **Layer 2 is not redundant with Layer 3, and this is the single most
> misunderstood point in this document.**
>
> RLS answers *"may this user touch this row?"* It does not answer *"does this
> write make sense?"* A `WITH CHECK (user_id = auth.uid())` policy happily
> accepts a transaction where `user_id` is yours and `account_id` belongs to
> someone else — every predicate passes, and you have written a row referencing
> a stranger's account.
>
> The fix is a cross-table `EXISTS` check in the policy **and** an application
> ownership check. Full explanation and the vulnerable-vs-correct policies:
> [rls-policies.md](../architecture/rls-policies.md#cross-table-ownership).

## Threats and mitigations

### T1 — Cross-tenant read (IDOR)

*An attacker requests another user's transaction, account, or goal by id.*

| Mitigation | Layer |
|---|---|
| `userId` derived from the session cookie, never from a parameter | 1 |
| Every query filtered by the session user | 2 |
| RLS `USING (user_id = auth.uid())` on every table | 3 |
| Cross-user access returns **not-found, not forbidden** — no existence leak | 2 |
| pgTAP tests assert every table returns zero rows cross-user (`M1-B03`) | Test |
| CI fails if any public table lacks RLS (`schema-drift.yml`) | Gate |

**Highest-severity threat in this application.** It gets the most controls and
the only gate that runs on every schema change.

### T2 — Cross-tenant write via foreign key

*An attacker creates a transaction referencing another user's `account_id`.*

The subtle one described above. Mitigations: cross-table `EXISTS` in
`WITH CHECK`; application-layer ownership verification; a pgTAP test that
specifically attempts a foreign-account insert and asserts failure (`M3-B04`).

### T3 — Session theft

| Mitigation |
|---|
| `httpOnly`, `Secure`, `SameSite=Lax` cookies — not readable by JavaScript |
| Short-lived JWT with refresh, rotated by `middleware.ts` |
| HTTPS everywhere (platform-enforced) |
| No token in a URL, log, or error message ([observability.md](../architecture/observability.md#never-log-this)) |
| Sign-out invalidates server-side |
| **A stolen session cannot change the password through the app** (M1-B05): `updatePassword` accepts only a session from a password-recovery link in the last hour (`amr` method `otp`, read through the verified `getClaims()`). An ordinary password login is refused |
| Changing the password revokes every other session's refresh token — Supabase Auth does this itself (verified by test) |
| `secure_password_change` on (local `config.toml`; preview `security_update_password_require_reauthentication`): Auth refuses a direct password change from a session that is not recent |

**Residual risk, stated plainly.** The anon key is public, so a session token
can call Auth's `PUT /auth/v1/user` directly, bypassing the app's recovery-only
rule. `secure_password_change` stops that only for sessions that are *not*
recent: probed in M1-B05, a freshly created password session changed its
password through the direct API with the setting on. So a **freshly stolen**
session can still take an account over. Closing it needs Auth to require the
current password or a reauthentication nonce for every change — no setting found
for that as of M1-B05 — or an app-level password-change flow that verifies the
current password before Auth is called, which a direct call would still skip.
Revisit with M9's security review.

### T4 — Secret leakage

| Mitigation |
|---|
| gitleaks on **full history**, every push and PR — a shallow scan misses the case that matters |
| Custom rules for `sb_secret_*` and `service_role` JWTs (`.gitleaks.toml`) |
| `service_role` never a GitHub Actions secret, and absent from every Vercel scope — no deployed code path may bypass RLS |
| `admin.ts` lint-restricted, and throws if bundled client-side |
| Only `NEXT_PUBLIC_*` reaches the browser — see [below](#public-vs-secret-environment-variables) |
| Trivy secret scanner as a second opinion |

### T5 — Injection

| Vector | Mitigation |
|---|---|
| SQL | Parameterised queries only via `supabase-js`. No string-built SQL, ever. |
| Prompt (V3 AI) | Untrusted transaction descriptions are **data, never instruction**. Scoped to the user's own rows. Called out now in `V3-M21` so it is designed in, not retrofitted. |
| XSS | React escapes by default. `dangerouslySetInnerHTML` is forbidden. |
| Header/log | Structured logging; no user text interpolated into log lines. |

### T6 — Mass assignment

*A crafted payload sets a column the user should not control —
`user_id`, `id`, `created_at`, or `exclude_from_safe_to_spend`.*

Mitigation: **explicit column allowlists.** Never spread client input into a
write. Zod schemas use `.strict()` so unknown keys are rejected rather than
ignored. See
[api-and-data-access.md](../architecture/api-and-data-access.md).

### T7 — Account enumeration

*Probing which emails have accounts, via sign-up or password-reset responses.*

Mitigation: **uniform responses.** "If that email has an account, we've sent a
link" regardless. Identical wording for sign-in failures whether the email
exists or the password was wrong (`M1-B05`).

As built in M1-B05 (`lib/server/actions/auth.ts`):

| Path | Uniform? | Evidence |
|---|---|---|
| Sign-in | **Yes.** Wrong password, unknown email, and unconfirmed account return byte-identical envelopes | Integration test. Raw Auth answers the unconfirmed case differently (`email_not_confirmed`), which is exactly what the mapping hides |
| Password reset | **Yes.** `{ ok: true }` whether or not the account exists | Integration test, plus Mailpit showing the real account did get the email |
| Sign-up | **No, by nature** | With email confirmation off, signing up with a registered email fails while a new one succeeds. No wording hides that. The fix is email confirmation (Auth then answers both alike); deciding it for production is M9's |
| Timing | **Not verified** | Auth may answer an unknown email faster than a wrong password. Not measured; mitigated, not closed, by the rate limits below |

**Rate limiting posture (M1-B05).** No app-level limiter in the MVP; the
credential endpoints rely on Supabase Auth's own per-IP limits. Values, from
`supabase/config.toml` (local) and the preview project's Auth config (2026-10-30):

| Limit | Value | Window |
|---|---|---|
| Sign-ups and sign-ins | 30 | 5 minutes, per IP |
| Token verifications (OTP, magic link, recovery) | 30 | 5 minutes, per IP |
| Token refreshes | 150 | 5 minutes, per IP |
| Emails sent (reset, confirmation) | 2 | per hour, project-wide — only enforced with real SMTP, so not locally (Mailpit) |

A limit hit returns `{ kind: 'rate_limited' }`. It is per-IP, not per-account,
so reporting it reveals nothing about which emails exist. An app-level limiter
(per-account lockout, CAPTCHA) is a post-MVP decision; Supabase supports
`[auth.captcha]` when needed.

### T8 — Denial of service via expensive computation

*Requesting a 90-day timeline with many weekly recurrence rules.*

Mitigation: horizon restricted to `7|30|60|90` (a throw otherwise);
`MAX_TIMELINE_EVENTS` cap with `truncated` disclosed to the UI; results cached
by tag. See [../domain/recurrence.md](../domain/recurrence.md#the-occurrence-cap)
and [../architecture/state-and-caching.md](../architecture/state-and-caching.md).

### T9 — Supply chain

| Mitigation |
|---|
| Every third-party action **SHA-pinned**; tags are mutable and CI has write potential |
| Dependabot on `github-actions` from day one, so pins do not rot |
| `npm ci` only — lockfile-reproducible installs |
| Trivy + `npm audit` + dependency review, blocking at HIGH on PRs |
| CodeQL `actions` analysis for workflow injection |
| Copyleft licences denied (SaaS incompatibility) |
| No `pull_request_target` anywhere; fork PRs receive no secrets |

### T10 — Money-math corruption

*Not an attacker — a bug. Included because the impact is comparable.*

| Mitigation |
|---|
| Integer minor units only; no floats ([../domain/money-and-rounding.md](../domain/money-and-rounding.md)) |
| Balances **derived** from transactions, never stored mutable |
| Canonical worked-example fixtures from the spec, as passing tests |
| Property tests for documented invariants |
| ≥95% coverage on Safe to Spend and Timeline; ≥90% across `lib/core` |
| `lib/core` is pure — no clock, no env, no I/O — so tests are deterministic |
| PR template requires a fixture test for any money-math change |

## Public vs secret environment variables

The `NEXT_PUBLIC_` prefix is a publication decision, not a naming convention.
Anything carrying it is compiled into the client bundle and is public forever.

| Variable | Public? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Public by design — **RLS** protects data, not this key's secrecy |
| `NEXT_PUBLIC_SITE_URL` | **Yes** | — |
| `SUPABASE_SERVICE_ROLE_KEY` | **NEVER** | Bypasses all RLS |
| `SUPABASE_DB_URL` | **NEVER** | Direct database credentials |
| `SUPABASE_ACCESS_TOKEN` | **NEVER** | Manages the Supabase project |

> [!WARNING]
> **`NEXT_PUBLIC_SUPABASE_ANON_KEY` being public is only safe because RLS is
> correct.** The anon key is an invitation to the API; RLS is what decides which
> rows the invitation reaches. A table shipped without RLS is world-readable to
> anyone who reads the JavaScript bundle — which is why
> `schema-drift.yml` fails the build rather than warning.

Adding a `NEXT_PUBLIC_` variable requires justifying, in the PR, that its value
is safe to publish. The PR template asks.

## Secrets inventory

| Secret | Stored in | Readable by | Rotation |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Nowhere hosted.** The maintainer's machine, for migration tooling and seed scripts. Absent from every Vercel scope and from GitHub Actions (M0-B10). | Local tooling only | Supabase dashboard → API keys. Rotate immediately on any suspected exposure. |
| `SUPABASE_DB_URL` | The maintainer's machine; GitHub Actions secret for release jobs. Not in Vercel. | Migration tooling; release workflow | Rotate DB password → update both |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions secret | Release workflow only | Revoke and reissue in Supabase account settings |
| `SUPABASE_PROJECT_ID` | GitHub Actions variable | Release workflow | Not secret; identifier only |
| Session JWTs | Browser httpOnly cookie | The user's browser | Auto-rotated by refresh |
| `GITLEAKS_LICENSE` | GitHub Actions secret (**if** needed) | Security workflow | Org accounts only; not needed here |

Rules:

- **The drift gate needs no secrets.** It runs a throwaway local Postgres, so it
  works on fork PRs — a deliberate design choice.
- **Production-touching jobs use GitHub Environments** with required reviewers.
- **On any suspected exposure:** rotate first, investigate second.

## Code review gates

Blocking checks for a human reviewer. The PR template encodes them; this is the
reasoning.

### Authorization — any Server Action or query

- [ ] `userId` from the session, never from input
- [ ] Every incoming `id` re-verified as owned, **even though RLS also enforces it**
- [ ] Explicit column allowlist on writes; no spreading of client input
- [ ] Zod `.strict()` — unknown keys rejected
- [ ] Cross-user access returns not-found, not forbidden
- [ ] No raw Postgres error reaches the client

### Schema — any `supabase/**` change

- [ ] RLS enabled on every new table
- [ ] Cross-table `EXISTS` in `WITH CHECK` wherever a FK is user-owned
- [ ] pgTAP isolation test added
- [ ] Forward-only, and backward-compatible with the deployed app
- [ ] No `security definer` function without `set search_path = ''` and a written justification

### Money — any `lib/core` or amount handling

- [ ] Integer minor units; no float, no `parseFloat`
- [ ] Rounding documented; largest-remainder where parts must sum to a whole
- [ ] Canonical spec fixture passes
- [ ] Pure — `today` injected, no `Date.now()`, no `process.env`

### Logging — any new log line

- [ ] No amount alongside identity
- [ ] No description, account name, email, or token
- [ ] Uses the typed `LoggableContext` allowlist

Review order — **money math → authorization/RLS → tests → naming → style** — is
set in [../../workflow/04-pull-requests.md](../../workflow/04-pull-requests.md).
Style is the linter's job; a reviewer's attention belongs on the two things that
lose users' money or expose their data.

## Out of scope

Stated so the boundary is deliberate rather than accidental:

- **Supabase's and Vercel's own infrastructure.** Vendor responsibility.
- **Local development stacks.** `supabase start` prints identical fixed
  credentials for every developer; the stack is not internet-reachable.
- **Multi-tenant sharing.** Shared household budgets (`V3-M25`) need an RLS
  redesign — flagged as the largest architectural change on the roadmap
  precisely because it changes this threat model.
- **Compliance certification** (PCI, SOC 2). No card data is stored; no
  certification is claimed. If bank integrations arrive (`V3-M26`), this section
  is rewritten first.
- **Client-side hardening against a compromised browser.** Malware on the user's
  device is outside what a web app can defend.
