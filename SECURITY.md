# Security Policy

This application handles personal financial data. Security reports are taken
seriously and are welcome.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(the **Security → Report a vulnerability** button on this repository).

Please include:

- What the issue is and where it lives (file, route, endpoint, or table).
- Steps to reproduce, or a proof of concept.
- What an attacker gains — read another user's data, write to it, escalate, deny service.
- Whether you believe it is already exploitable in production.

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement | Within 3 days |
| Initial assessment and severity | Within 7 days |
| Fix for critical/high severity | As fast as practical; you will get a timeline |
| Disclosure | Coordinated with you, after a fix ships |

This is a portfolio project maintained by one person, so these are
best-effort targets rather than a commercial SLA.

## Scope

**In scope** — anything that lets one user reach another user's financial data,
or that exposes credentials:

- Row Level Security bypass or cross-tenant data access (any read or write of
  another user's rows).
- Authentication or session flaws — fixation, theft, privilege escalation.
- Server Actions or Route Handlers that trust client-supplied ownership
  (an `id` accepted without a server-side ownership re-check).
- Injection: SQL, command, template, or prompt injection into AI features.
- Secret exposure — a secret reachable from client bundles, logs, or the repo.
- Money-math flaws that let a user corrupt or misrepresent balances.
- Supply-chain issues in dependencies or GitHub Actions workflows.

**Out of scope:**

- Findings against a local development stack (`supabase start` prints the same
  fixed demo credentials for every developer; the local stack is not
  internet-reachable).
- Missing hardening headers with no demonstrated impact.
- Automated scanner output with no working proof of concept.
- Denial of service by brute-force volume against a hosted preview.
- Social engineering, physical access, or attacks on Supabase's or Vercel's
  own infrastructure — report those to the respective vendor.

## Our own controls

The threat model, trust boundaries, and mitigations are documented publicly:

- [docs/security/security-model.md](docs/security/security-model.md) — threat model and controls
- [docs/security/ci-security-gates.md](docs/security/ci-security-gates.md) — automated scanning
- [docs/architecture/rls-policies.md](docs/architecture/rls-policies.md) — data isolation design

Every pull request runs secret scanning (gitleaks), vulnerability and
misconfiguration scanning (Trivy), static analysis (CodeQL), dependency
review, and — once the schema exists — automated tests proving every table is
user-isolated.

## Safe harbour

Good-faith research following this policy is welcome and will not be met with
legal action. Please avoid accessing, modifying, or retaining data belonging to
anyone but yourself, and give a reasonable window to fix an issue before
disclosing it publicly.
