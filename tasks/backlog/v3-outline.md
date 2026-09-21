# V3 Roadmap — Outline

**Status: long-term. Sketches only.** These are directions, not plans. Several
would change the architecture materially, and those are flagged.

Source: spec §28. Spec §21's framing governs the AI work: *"AI should enhance
the application rather than become the main product."*

---

## V3-M18 — Financial Health

**Goal.** Spec §19. A breakdown across dimensions, **deliberately not a single
score**.

Spec §19 is explicit about this, and the reasoning is sound: a single number
hides which part is bad and invites gaming. Six dimensions with their own
statuses — cash flow, budget control, savings, debt, emergency fund — are
actionable in a way that "your score is 72" is not.

- Metrics from spec §19: savings rate, expense-to-income ratio, emergency-fund
  coverage, debt-to-income ratio, budget adherence, monthly cash flow
- Each is a pure function over existing aggregates
- Thresholds need care — they are financial advice in effect, and should be
  presented as heuristics rather than verdicts
- Spec §32's non-judgmental requirement applies strongly: a red dimension is a
  fact, not a failing

## V3-M19 — AI Smart Categorization

**Goal.** Spec §21. Categorise transactions automatically.

- Suggest, never silently assign. A wrong category quietly applied corrupts
  every downstream figure — the breakdown, the budgets, the insights
- Learn from the user's own corrections
- **Constraint: the user's own data only.** Spec §21 states it, and it is a
  privacy commitment, not an implementation detail
- Confidence threshold below which no suggestion is offered

## V3-M20 — Natural Language Transaction Entry

**Goal.** Spec §21. *"Spent ₱450 on lunch"* → a structured transaction.

- Parse amount, category, type, and date from free text
- **Always show the parsed result for confirmation before saving.** The failure
  mode — a misparsed amount saved silently — is exactly the kind of error this
  app must not make
- Reuse the locale-safe amount parser rather than letting a model produce the
  number
- Falls back to the normal form on low confidence

## V3-M21 — Financial Assistant

**Goal.** Spec §21. Answer questions about the user's own finances.

> [!IMPORTANT]
> **Prompt injection and data isolation are designed in, not retrofitted.**
> Flagged now because retrofitting them is not really possible.

- **Strictly scoped to the user's own data.** Every query the assistant makes
  runs through the same RLS-scoped path as the rest of the app — the assistant
  gets no privileged database access, ever
- **Transaction descriptions are untrusted input.** A user's description field —
  or an imported one — is data, never instruction. Spec §21's examples assume
  benign data; a real system cannot
  ([security-model.md](../../docs/security/security-model.md) T5)
- Answers cite the records they are derived from, so a user can check them
- The assistant must not compute money itself; it calls the same `lib/core`
  functions the UI does, so its answers cannot disagree with the dashboard
- Spec §21's example questions are the target: *where did most of my money go?*,
  *can I afford ₱8,000 headphones?*

## V3-M22 — Subscription Detection

**Goal.** Find recurring charges the user has not modelled.

- Pattern detection over transaction history — similar amount, similar merchant,
  regular interval
- Offer to create a recurring rule from a detected pattern
- Surface forgotten subscriptions, which is the feature's real value
- Reuses the recurrence machinery from [M8](m8-money-timeline.md) in reverse

## V3-M23 — Debt Planner

**Goal.** Replace the MVP's simplification of debt.

[safe-to-spend.md](../../docs/domain/safe-to-spend.md#debtpayments) models debt
minimums as ordinary scheduled expenses and says so plainly. A real model needs:

- Statement balance, APR, minimum-payment calculation
- Interest accrual and amortisation
- Payoff strategies — avalanche, snowball — and their projected dates
- Integration with Safe to Spend's `DebtPayments` term, replacing the
  approximation

## V3-M24 — Investment Tracking

**Goal.** Spec §28. Assets beyond cash accounts.

- Holdings with cost basis and current value
- Net worth as distinct from spendable balance — the distinction
  `exclude_from_safe_to_spend` already gestures at
- Price data introduces an external dependency and a staleness problem the app
  has so far avoided

## V3-M25 — Shared Household Budgets

> [!WARNING]
> **The largest architectural change on the roadmap.** A multi-tenant RLS
> redesign.

Every policy in
[rls-policies.md](../../docs/architecture/rls-policies.md) assumes
`user_id = auth.uid()` — one row, one owner. Sharing breaks that assumption
everywhere at once:

- Ownership becomes membership: a household, roles, invitations
- **Every policy, every cross-table check, and every pgTAP test is rewritten**
- The three-layer rule still holds, but layer 2's ownership question becomes
  "is this user a member of the owning household, with sufficient role?"
- Cache tags are namespaced by user today
  ([state-and-caching.md](../../docs/architecture/state-and-caching.md#cache-tags));
  they would need to be namespaced by household, and invalidation would need to
  reach other members' sessions
- The threat model changes: partial sharing, leaving a household, and what a
  removed member retains are all new questions
- Needs its own ADR before any code, superseding parts of ADR-0002's assumptions

Worth doing. Worth not underestimating.

## V3-M26 — Bank Integrations

**Goal.** Spec §28. Automatic transaction import.

- An aggregator (Plaid or a regional equivalent — Philippine coverage is the
  practical constraint)
- **Changes the compliance posture entirely.** Handling bank credentials or
  tokens moves this from "a portfolio app holding self-entered data" to
  something with real regulatory surface.
  [security-model.md](../../docs/security/security-model.md)'s out-of-scope
  section explicitly says it is rewritten first if this happens
- Deduplication against manually entered transactions
- Reconciliation UI for mismatches

## V3-M27 — Mobile / PWA

**Goal.** Spec §28.

- Installable, offline-capable
- Offline transaction drafts syncing on reconnect — the first genuine case for
  client-side state beyond the URL, and the condition
  [state-and-caching.md](../../docs/architecture/state-and-caching.md#why-no-global-client-store)
  named for revisiting that decision
- Push notifications, building on V2-M15
- The app is already responsive to 360 px from
  [M9-F02](m9-mvp-hardening-and-launch.md), so this is about installability and
  offline rather than layout

---

## Notes

- **Spec §21's framing is a constraint, not a preamble.** AI enhances; it does
  not become the product. A feature that only works when the model is right is
  not a budgeting app.
- **V3-M25 needs an ADR before any code.** It contradicts assumptions baked into
  every policy and every cache tag.
- **V3-M26 changes what this project is.** Flagged so the decision is
  deliberate.
- Several of these — V3-M22, V3-M23 — are ordinary product work that happens to
  be scheduled late. They do not carry the architectural risk the AI and sharing
  items do.
