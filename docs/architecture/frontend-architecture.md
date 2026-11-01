# Frontend Architecture

**Shape in one sentence:** Server Components render the money, Client
Components handle the interaction, the charting library is quarantined behind
one directory, and the brand's playful voice is applied hardest exactly where
the news is bad.

Related: [source-structure.md](source-structure.md),
[state-and-caching.md](state-and-caching.md),
[system-architecture.md](system-architecture.md),
[../product/product-spec.md](../product/product-spec.md) (spec §25 navigation,
spec §32 brand direction).

## Contents

- [Route groups](#route-groups)
- [The server/client boundary](#the-serverclient-boundary)
- [shadcn/ui conventions](#shadcnui-conventions)
- [Chart isolation](#chart-isolation)
- [Forms that call a Server Action](#forms-that-call-a-server-action)
- [Design tokens](#design-tokens)
- [App icon](#app-icon)
- [Money formatting](#money-formatting)
- [Accessibility baseline](#accessibility-baseline)
- [Brand voice](#brand-voice)

## Route groups

Three groups, three layouts, three different auth postures:

| Group | Auth | Layout | Routes |
|---|---|---|---|
| `(marketing)` | Public | Marketing chrome | `/`, pricing, about |
| `(auth)` | Public, **redirects if signed in** | Centred card, no nav | `/login`, `/sign-up`, `/reset-password` |
| `(app)` | **Required**, redirects to `/login?next=` | Sidebar shell | The nine app routes |

The parentheses keep group names out of the URL. `proxy.ts` enforces both
redirect directions, and both are integration-tested (`M1-B06`) — an
authenticated user landing on `/login` is as much a bug as an anonymous user
reaching `/dashboard`.

Navigation is spec §25's nine items, in that order:

```text
Dashboard · Transactions · Budget · Goals · Timeline
Accounts · Reports · What If? · Settings

Primary CTA (always visible):  + Add Transaction
```

`What If?` ships as a placeholder route in the MVP — it is V2 (spec §18), but it
appears in the nav from M0 so the information architecture does not shift
underneath users later.

**`+ Add Transaction` is globally reachable**, not per-page (task `M3-F01`).
Recording a transaction is the app's most frequent action, and spec §33's
principle — the smallest product that makes the user say "now I know where my
money is going" — depends on that action being frictionless. On mobile it sits
within thumb reach.

## The server/client boundary

**Server Components are the default.** `'use client'` requires one of exactly
three justifications:

1. **Interaction** — event handlers, controlled form state.
2. **Browser API** — `localStorage`, `matchMedia`, `IntersectionObserver`.
3. **Chart rendering** — the library requires the DOM.

If none applies, it stays a Server Component.

| Concern | Component type | Why |
|---|---|---|
| Page shells, layouts | Server | No interaction |
| Active nav item (`NavLink`) | Client | `aria-current` needs `usePathname()`; a server layout never receives the path |
| Any money figure or total | **Server** | `lib/core` is server-only; see below |
| Lists and tables | Server | Rendered from RLS-scoped reads |
| Forms | Client | Controlled inputs, validation feedback |
| Dialogs, sheets, popovers | Client | Open/close state |
| Charts | Client, inside `components/charts` | DOM-dependent |
| Filter controls | Client, writing to URL params | Interaction; state lives in the URL |

> [!IMPORTANT]
> **No component computes money.** A displayed total, balance, projection, or
> percentage arrives as a prop from a Server Component that got it from
> `lib/core`. Components format and lay out; they never add, divide, or
> project.
>
> This is enforced by lint — `components/**` cannot import `lib/server`, and
> `lib/core` cannot be reached from a Client Component bundle
> ([source-structure.md](source-structure.md#import-rules)). The reason is
> concrete: Safe to Spend depends on horizons, exclusion flags, and
> occurrence dedupe ([../domain/safe-to-spend.md](../domain/safe-to-spend.md)),
> and a component "just summing the rows it has" would produce a
> confidently wrong number.

Client Components receive plain serialisable data. Domain types from
`lib/core/types.ts` cross the boundary; database row types never do — mappers
convert first ([source-structure.md](source-structure.md#conventions)).

## shadcn/ui conventions

shadcn components are **copied into `components/ui/`, not installed**. That is
the model, and it has consequences worth stating:

- **Generated files stay close to upstream.** Restyle via design tokens and
  `className`, not by rewriting the primitive. A heavily-edited primitive cannot
  be regenerated when upstream fixes an accessibility bug.
- **When a primitive genuinely needs different behaviour**, wrap it in
  `components/<feature>/` rather than forking it.
- **Feature components compose primitives**; primitives never import feature
  components.

Primitives installed by M0-F01 (style `radix-nova`): `button`, `input`,
`label`, `select`, `dialog`, `sheet`, `drawer`, `dropdown-menu`, `popover`,
`table`, `card`, `badge`, `progress`, `skeleton`, `sonner` (shadcn's toast),
`tabs`, `field`, `alert`, and `separator` (a dependency of `field`).

- **`field`, not `form`.** In the current registry `form` is an empty stub;
  `field` replaces it — label, description, and an accessible error, with no
  form-library dependency. The form library is chosen when the first real form
  lands.
- **`calendar` is deferred** to the first task that needs a date picker. It
  pulls in `react-day-picker` and `date-fns`, and
  [ADR-0003](../adr/0003-pure-typescript-domain-core.md) kept a date library
  out deliberately; that trade-off deserves its own decision, not a side effect
  of installing primitives.
- **Local edits to generated files are marked** with a `Local change:` comment
  (today: one cast in `sonner.tsx` for `exactOptionalPropertyTypes`). Four
  stylistic lint rules are relaxed for `components/ui/**` instead of editing
  upstream code — see `eslint.config.mjs`.

`/dev/kitchen-sink` renders every primitive in default, hover, focus, disabled,
and error states, at both extremes of the type scale, with a theme toggle. It
exists because a token change silently breaking one variant is otherwise found
by a user. Hover and focus render statically through a `data-force-state`
attribute that the `hover` and `focus-visible` variants in `app/globals.css`
also match. Production builds return 404 for the route.

## Chart isolation

**`components/charts/` is the only place the charting library may be imported.**
Enforced by lint.

```text
components/charts/
  cash-flow-chart.tsx        # income vs expense over time      (M4-F02)
  category-breakdown.tsx     # spending by category, donut/bar   (M4-F03)
  projected-balance-chart.tsx # timeline projection line         (M8-F03)
  chart-container.tsx        # shared responsive + a11y wrapper
  chart-theme.ts             # token → chart colour mapping
```

Three reasons this quarantine is worth a lint rule:

- **Swappability.** Spec §23 says "Recharts or another charting library" — an
  explicitly open decision. Confined to one directory, changing it is a
  contained task; spread across pages, it is a rewrite.
- **Bundle control.** A charting library is among the largest client
  dependencies. One directory of `'use client'` boundaries means it loads on
  pages with charts and nowhere else.
- **Consistent theming and a11y.** Every chart inherits the same tokens and the
  same accessible-fallback treatment because they all go through
  `chart-container`.

Charts take **already-computed series** as props. Aggregation happens in
`lib/core/aggregates` (`M4-B01`, `M4-B02`) — including largest-remainder
rounding so category shares sum to exactly 100%
([../domain/money-and-rounding.md](../domain/money-and-rounding.md)).

## Forms that call a Server Action

Established by the auth pages (`M1-F01`/`F02`); follow it for every form.

- **The page wires the action, the component renders the form.** `components/`
  may not import `lib/server`, so a Server Component page defines a small
  `'use server'` adapter and passes it to a client form as a prop. The adapter
  picks only the form's own fields (`lib/utils/form-data.ts` — Next adds hidden
  `$ACTION_…` inputs that a strict schema would reject) and converts the result
  envelope into what the form renders (`app/(auth)/form-state.ts`).
- **`useActionState`** drives submit, pending, and returned errors — which also
  makes the form work **without JavaScript** (progressive enhancement,
  E2E-tested).
- **Inline validation uses the same schema as the action**
  (`components/auth/use-field-validation.ts`): checked on blur and on submit; an
  invalid form is not sent and focus moves to the first problem. On a valid
  submit the client's verdicts are cleared, so the **server's** field errors are
  what the form shows next.
- **Field errors** are tied to the input with `aria-describedby` and
  `aria-invalid`; a **form-level message** renders in a summary that takes focus
  and is announced. Inputs are `h-11` (44px touch target).

## Design tokens

CSS custom properties, defined once, consumed everywhere. Tailwind maps to them
rather than to raw hex values, so no component hardcodes a colour.

```text
Semantic (not literal) naming — defined in app/globals.css, both themes:

--background / --foreground, --card, --popover, --muted / --muted-foreground,
--border, --input, --ring          surfaces and text (shadcn's names)
--primary, --destructive           brand action, irreversible action
--income                           money in      (green family)
--expense                          money out     (red family)
--status-green / -amber / -red     Safe to Spend bands AND budget bands
```

Tailwind exposes each as a utility (`text-income`, `bg-status-amber`). Budget
statuses (`on_track` / `at_risk` / `over` / `exceeded`) map onto the three
status colours in M5; the mapping is a budget-UI decision, not a token.

**AA is a test, not a promise.** `tests/unit/design/contrast.test.ts` parses the
tokens out of `app/globals.css` and asserts every rendered pair in both themes:
4.5:1 for text, 3:1 for the input boundary and the focus ring. A palette change
that drops a pair below AA fails `npm run test`.

**Money direction is a semantic token, not a literal colour**, because it must
carry meaning in dark mode, at AA contrast, and — crucially — never *only* by
colour. Income and expense rows also differ by sign and by an explicit `+`/`−`,
so the distinction survives colour blindness and greyscale printing.

Both themes are first-class from M0-F01. Dark mode is common for finance apps
checked at night, and retrofitting a token system later means auditing every
component.

The palette itself is a brand decision task, not fixed here; the *structure* —
semantic names, both themes, AA contrast — is.

## App icon

The mark answers the product's question: an open wallet, and a peso coin
sprouting a wing and leaving it. On a solid money-green tile (the `--income`
hue) so it reads on light and dark browser tabs alike, and kept to three bold
shapes so it survives 16px.

| File | Served as | Notes |
|---|---|---|
| `app/icon.svg` | `<link rel="icon" type="image/svg+xml">` | The source of truth. Hex colours, not tokens: a favicon cannot read CSS variables |
| `app/apple-icon.png` | `<link rel="apple-touch-icon">`, 180×180 | iOS needs a PNG and rounds the corners itself, so this is the SVG rendered full-bleed (`rx="0"`) |

Both are Next.js file conventions — no `metadata.icons` entry. The E2E smoke
test fetches each linked icon and checks its content type, so a broken or
missing file fails CI.

**Changing the icon:** edit `icon.svg`, check it at 16, 32, and 180px on a light
and a dark background, then regenerate `apple-icon.png` from a copy with the
tile's `rx` set to `0` (any headless browser screenshot at 180×180 works; this
repo's Playwright Chromium is enough). XML comments must not contain `--` —
one did, and the browser silently refused the whole file.

## Money formatting

```typescript
// lib/utils/money.ts   — NOT lib/core

export function formatMoney(
  amountMinor: number,
  currency: string,      // from the profile; 'PHP' default per spec
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}
```

Rules:

- **Formatting lives in `lib/utils`, never `lib/core`.** `lib/core` is pure
  arithmetic on integers; it must not know about locales, and `Intl` output
  varies by ICU version, which would make pure-function tests
  environment-dependent.
- **`amountMinor / 100` happens only at the display edge.** That is the single
  permitted place a money value becomes a float, and its result is a string that
  never re-enters arithmetic.
- **`₱` is the default** (spec's examples throughout), driven by
  `profiles.currency`, not hardcoded.
- **Signed display is explicit:** `+₱35,000` / `−₱15,000`, matching spec §10's
  timeline. The sign comes from the transaction type, not from a negative
  stored amount ([data-model.md](data-model.md)).
- **Parsing is the inverse and is locale-aware** — `parseMoneyToMinor` handles
  thousands separators, a `₱` prefix, and comma-vs-period decimals. Never
  `parseFloat`. See
  [../domain/money-and-rounding.md](../domain/money-and-rounding.md#parsing-at-the-boundary).
- **Large figures may abbreviate in chart axes** (`₱35k`) but **never** in a
  balance, total, or Safe to Spend figure. Precision matters where the user is
  making a decision.

## Accessibility baseline

Non-negotiable from M0, audited in `M9-F01`:

| Requirement | Standard |
|---|---|
| Contrast | WCAG **AA** — 4.5:1 text, 3:1 large text and UI boundaries, in **both** themes |
| Keyboard | Every interactive element reachable and operable; logical tab order |
| Focus | Visible indicator, never `outline: none` without a replacement |
| Touch targets | **≥ 44×44 px** |
| Labels | Every input has a real `<label>`; placeholders are not labels |
| Errors | Programmatically associated, announced, and specific |
| Motion | Respect `prefers-reduced-motion` |
| Landmarks | One `<main>`, one `<h1>`, meaningful heading order |
| Automated check | `axe` clean in CI |

### Menus and popovers (from M1-F04)

Two Radix defaults fail axe; the account menu shows the fix for every later one:

- **Non-modal** (`<DropdownMenu modal={false}>`). A modal menu marks the rest of
  the page `aria-hidden`, which axe reports as `aria-hidden-focus` — and the page
  appears to lose its `<main>` and `<h1>`. The WAI-ARIA menu button pattern does
  not hide the page.
- **Portal inside a landmark** (`DropdownMenuContent`'s `container` prop). The
  default portals to the end of `<body>`, outside every landmark, which fails
  axe's `region` rule.

### Charts need a text equivalent

Every chart renders an **accessible fallback table** — visually hidden by
default, exposed via a "view as table" toggle. A screen-reader user must be able
to get the numbers.

This is not only an accessibility win: the same table is what a sighted user
wants when reading exact figures off a donut chart, so the toggle is a real
feature. Charts also carry `role="img"` with a summarising `aria-label`
(*"Cash flow, September: income ₱47,000, expenses ₱31,200"*).

### Safe to Spend has specific requirements

The hero card (`M7-F01`) shows a status via 🟢/🟡/🔴. That must not be the only
signal:

- The **band is stated in text**, not just coloured.
- The **breakdown drawer** (`M7-F02`) is a real `<table>` with headers — it
  reproduces spec §9's arithmetic, and arithmetic read aloud needs structure.
- Every breakdown line links to its source record, keyboard-reachable.

## Brand voice

Spec §32: playful, friendly, slightly goofy, non-judgmental, simple, modern —
*"humor without making financial information feel unserious."*

The operating rule: **the data is never funny; the framing sometimes is.**

| Surface | Voice |
|---|---|
| Amounts, totals, dates, tables | **Plain.** No jokes near a number the user is deciding on. |
| Empty states | Warmest. Nothing to be careful about yet. |
| Success confirmations | Light. |
| Section headers, nudges | Gently playful. |
| Warnings (budget at risk, low STS) | Playful **but** clear and actionable. |
| Bad news (over budget, shortfall, negative STS) | **Non-judgmental above all.** |

Spec §32's examples mapped to where they belong:

| Copy | Surface |
|---|---|
| *"Your wallet survived another month. Barely."* | Monthly summary, positive-but-tight |
| *"You spent ₱2,400 on food. We won't judge."* | Budget exceeded — factual, no scolding |
| *"Hala. You're getting close to your shopping budget."* | Budget at risk (`M5-F03`) |
| *"Good news: future-you still has money."* | Positive Safe to Spend (`M7-F01`) |

### The rule that matters most

> [!IMPORTANT]
> **Bad-news states get the most care, not the least.**
>
> A user seeing a negative Safe to Spend or a projected shortfall is already
> stressed. Three prohibitions in those states:
>
> - **No jokes at the user's expense.** *"We won't judge"* works because it
>   removes judgement. A punchline about overspending adds it.
> - **No alarm styling.** Red text and warning icons everywhere turn a normal
>   month into a crisis. State it once, clearly.
> - **Always offer the next step.** *"You're ₱2,000 short before payday"* is a
>   verdict. Adding *"here's what's coming up"* with a link to the timeline
>   makes it actionable.
>
> Spec §1 frames the product as answering *"how much can I safely spend"* — a
> question people ask when they are worried. Spec §33 asks for clarity over
> commentary. Together they mean: in the worst state, be useful and quiet.

Copy lives in the UI layer. `lib/core` returns a `status` and the numbers; the
component decides the words. Same separation as formatting — and it keeps the
money math testable without asserting on prose.
