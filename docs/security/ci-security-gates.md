# CI Security Gates

**Shape in one sentence:** five scanners with different blind spots, each
blocking a pull request only for findings that are actually actionable — and a
suppression process that requires a reason, an owner, and an expiry date,
because an undated suppression is a permanent blind spot.

Related: [security-model.md](security-model.md),
[../../workflow/08-ci-gates.md](../../workflow/08-ci-gates.md),
[../../.gitleaks.toml](../../.gitleaks.toml),
[../../.trivyignore](../../.trivyignore).

## Contents

- [What each gate catches](#what-each-gate-catches)
- [Blocking thresholds](#blocking-thresholds)
- [Why actions are SHA-pinned](#why-actions-are-sha-pinned)
- [Reproducing a gate locally](#reproducing-a-gate-locally)
- [Triage](#triage)
- [Suppression](#suppression)
- [If a secret is committed](#if-a-secret-is-committed)

## What each gate catches

Five scanners, chosen because their coverage barely overlaps. Any one alone
leaves a gap the others cover.

| Gate | Catches | Misses |
|---|---|---|
| **gitleaks** | Secrets in git **history** — including ones "removed" in a later commit | Secrets never committed; secrets in a running environment |
| **Trivy** | Known CVEs in dependencies; misconfigured YAML/IaC; secrets in the working tree | Logic bugs; anything unpublished |
| **CodeQL** | Injection, taint flows, unsafe patterns in our own code; **workflow injection** in Actions | Third-party code; runtime configuration |
| **dependency review** | Newly *introduced* vulnerable or copyleft dependencies, on the diff | Existing dependencies already in `main` |
| **npm audit** | Advisories against the resolved lockfile tree | Non-npm risk; unpublished advisories |

Three details worth knowing:

- **gitleaks scans with `fetch-depth: 0`.** A shallow clone scans only the tip
  commit, which misses the exact case this gate exists for.
- **Trivy and gitleaks run unconditionally**, before any application code
  exists. Trivy's `misconfig` scanner analyses the workflow files themselves, so
  it has value on a docs-only repo.
- **CodeQL includes the `actions` language.** It analyses
  `.github/workflows/**` for script injection and over-broad permissions — and
  that works today.

## Blocking thresholds

Deliberately asymmetric: block a PR that *introduces* a problem; do not turn
`main` red for a CVE disclosed overnight in a dependency nobody touched.

| Gate | On PR | On `main` / schedule |
|---|---|---|
| gitleaks | **Blocks — any finding** | Blocks |
| Trivy | **Blocks at HIGH/CRITICAL** (fixable only) | Reports to Security tab; does not block |
| CodeQL | Reports; alerts on the Security tab | Reports |
| dependency review | **Blocks at HIGH**, and on denied licences | n/a (PR only) |
| npm audit (prod deps) | **Blocks at HIGH** | Blocks |
| npm audit (all deps) | Informational | Informational |

Reasoning for each choice:

- **gitleaks blocks on anything.** There is no "low severity" leaked
  credential. False positives get an allowlist entry with a reason.
- **Trivy uses `ignore-unfixed: true`.** A CVE with no available patch is not
  something a PR author can act on; blocking on it only teaches people to
  bypass the gate. Unfixed criticals still appear in the Security tab.
- **Trivy's two-pass structure** — report-always plus a PR-only failing pass —
  means the Security tab accumulates history while `main` stays green.
- **npm audit blocks only on production dependencies** (`--omit=dev`). A
  dev-tool advisory never reaches a user's browser or our server.
- **CodeQL never blocks.** Static analysis on financial code produces enough
  nuanced findings that a blocking gate would be routinely overridden. Alerts go
  to the Security tab and are triaged in `M9-B01`.

## Why actions are SHA-pinned

Every third-party action is pinned to a full commit SHA with a version comment:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

**A tag is mutable.** `@v4` is a pointer the upstream owner can move at any
time, to any commit. A workflow runs with a token that has repository write
potential and access to whatever secrets the job declares — so "trust whatever
this tag points at today" is a supply-chain vulnerability, not a convenience.

The trade-off is that pins rot. That is exactly why `dependabot.yml` includes
the `github-actions` ecosystem from day one: Dependabot proposes SHA bumps
weekly with the version comment updated, so pinning stays sustainable rather
than becoming a chore people abandon.

`actions/*` (first-party GitHub) are pinned too — consistency means the rule has
no exceptions to remember, and CodeQL's `actions` analysis flags unpinned uses.

> [!NOTE]
> **Every action is SHA-pinned.** The local check below greps for tag-pinned
> actions and should print nothing. Two `supabase/setup-cli` pins were
> outstanding while its jobs were skipping; both were resolved once `gh` was
> available to look up the real SHA.

## Reproducing a gate locally

Never push to see whether a gate passes.

```bash
# gitleaks — full history, project config
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect \
  --source=/repo --config=/repo/.gitleaks.toml --verbose

# Trivy — the same scanners CI runs
docker run --rm -v "${PWD}:/repo" aquasec/trivy:latest fs \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL --ignore-unfixed /repo

# npm audit — the blocking pass
npm audit --audit-level=high --omit=dev

# Markdown + relative links (the docs gate)
npx markdownlint-cli2 "**/*.md"
npx lychee --offline --no-progress .

# Confirm no action is tag-pinned — this must print nothing
grep -rn "uses:.*@v[0-9]" .github/workflows/ .github/actions/
```

CodeQL and dependency review are impractical locally; they run on the PR.

## Triage

A gate fires. In order:

**1. Is it real?**
Read the finding, not just the rule name. For a dependency CVE, check whether
the vulnerable *code path* is one this app uses — a parser flaw in a transitive
dependency used only for a CLI flag is a different risk from one in the
authentication path.

**2. Can it be fixed now?**
Upgrade, remove, or change the code. **Fixing is the default**, and for a
gitleaks finding it is the only option.

**3. Is it a false positive?**
Then the *detector* is wrong and the fix belongs in configuration — an
allowlist entry with a comment explaining why, not a suppression of the finding.

**4. Genuine, unfixable, and not exploitable here?**
Only now consider a suppression, per the rules below.

**5. Does it need an issue?**
Anything not fixed in the PR gets a `type:security` issue with a priority.
`p0`/`p1` security issues block the milestone
([../../workflow/07-definition-of-ready-and-done.md](../../workflow/07-definition-of-ready-and-done.md)).

Escalate to `priority:p0` immediately for: any leaked credential; any finding
implying cross-tenant access; any RLS gap.

## Suppression

Suppressing a finding is a decision to accept risk. It requires four things, and
the review will ask for all four.

| Requirement | Why |
|---|---|
| **A reason** | Specifically why it is not exploitable *here* |
| **An owner** | Someone accountable for revisiting it |
| **An expiry date** | An undated suppression is a permanent blind spot |
| **Review approval** | Not a solo call, even on a solo project — write the justification as if for someone else |

```text
# .trivyignore
CVE-2026-12345 exp:2026-12-01
# why: vulnerable code path is the library's CLI entry point, which we never
#      invoke; no patched release exists yet.  owner: @jorge
```

**"It's noisy" is not a reason.** Noise means the configuration needs tuning, and
tuning the detector is a different action from suppressing a finding.

**Never suppressible:** a real leaked credential; a finding indicating a
cross-tenant path; a missing RLS policy. Rotate, fix, or revert.

The Monday scheduled scan resurfaces everything, so an expired suppression comes
back into view rather than sitting silently forever.

## If a secret is committed

Assume it is compromised the moment it lands in a public repository — this repo
is public, and public repositories are scraped for credentials continuously.

**Rotate first. Investigate second. Clean history last.**

```text
1. ROTATE the credential immediately.
   Supabase dashboard → new key → update Vercel env → redeploy.
   The old value is now worthless, which is the only real fix.

2. ASSESS blast radius.
   service_role key  → assume all user data was readable. Check Supabase
                       logs for unfamiliar access.
   DB password       → same.
   access token      → check for unexpected project changes.

3. REMOVE from the working tree and commit.

4. HISTORY REWRITE is optional and secondary.
   git-filter-repo can excise it, but forks, clones, caches, and GitHub's
   own archives may already hold it. Rewriting history is hygiene; it is
   NOT remediation. Rotation is remediation.

5. RECORD IT.
   File a type:security issue: what leaked, when, rotated at, blast radius,
   and which control should have caught it.

6. FIX THE CONTROL.
   Every leak means a gap. Add the gitleaks rule that would have caught it
   (.gitleaks.toml) so this specific shape cannot recur.
```

Step 6 is the one that gets skipped and matters most. A leak that produces no
new detection rule will happen again.
