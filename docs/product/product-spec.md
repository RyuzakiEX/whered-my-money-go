# Where'd My Money Go

> A simple budgeting app that answers one question: Where'd my money go?

| | |
|---|---|
| **Project slug** | `whered-my-money-go` |
| **Document type** | Product specification — canonical source of truth for *what* the product does |
| **Status** | MVP not yet started — see [tasks/milestones.md](../../tasks/milestones.md) |
| **Reformatted** | 2026-09-09 (from `plan.md`; content unchanged) |

> [!NOTE]
> This document is a **faithful transcription** of the original product spec.
> No requirement has been added, removed, reworded, or reordered — only the
> markdown formatting changed. Every design *decision* derived from this spec
> (column types, formulas, constraints, thresholds) lives in
> [../architecture/](../architecture/) and [../domain/](../domain/) instead, so
> that this file stays a record of product intent rather than implementation.

## Contents

1. [Product Vision](#1-product-vision)
2. [Product Philosophy](#2-product-philosophy)
3. [Target Users](#3-target-users)
4. [Core Features](#4-core-features)
5. [Accounts](#5-accounts)
6. [Transactions](#6-transactions)
7. [Categories](#7-categories)
8. [Dashboard](#8-dashboard)
9. [Safe to Spend ⭐](#9-safe-to-spend-)
10. [Money Timeline ⭐](#10-money-timeline-)
11. [Budgets](#11-budgets)
12. [Budget Forecasting](#12-budget-forecasting) *(V2)*
13. [Savings Goals](#13-savings-goals)
14. [Goal Impact](#14-goal-impact) *(V2)*
15. [Recurring Transactions](#15-recurring-transactions) *(V2)*
16. [Reports](#16-reports)
17. [Monthly Insights](#17-monthly-insights) *(V2)*
18. [What-If Scenarios ⭐](#18-what-if-scenarios-) *(V2)*
19. [Financial Health](#19-financial-health) *(V3)*
20. [Notifications](#20-notifications) *(V2)*
21. [AI Features](#21-ai-features) *(V3)*
22. [Data Model](#22-data-model)
23. [Tech Stack](#23-tech-stack)
24. [Security](#24-security)
25. [Application Structure](#25-application-structure)
26. [MVP Scope](#26-mvp-scope)
27. [V2 Roadmap](#27-v2-roadmap)
28. [V3 Roadmap](#28-v3-roadmap)
29. [Product Differentiators](#29-product-differentiators)
30. [Core User Journey](#30-core-user-journey)
31. [Success Criteria](#31-success-criteria)
32. [Brand Direction](#32-brand-direction)
33. [MVP Principle](#33-mvp-principle)

---

## 1. Product Vision

Where'd My Money Go is a personal finance SaaS app designed to help users:

- Understand where their money goes
- Know how much money they can safely spend
- Plan for upcoming expenses
- Track savings goals
- Understand their financial habits
- Simulate financial decisions before making them

The goal is to go beyond traditional expense tracking.

Instead of only showing:

> "You spent ₱35,000 this month."

The app should answer:

> "You have ₱12,400 that's actually safe to spend after accounting for your
> upcoming bills, savings target, and expected income."

---

## 2. Product Philosophy

**Track → Understand → Forecast → Decide**

The application should progressively move the user from recording financial
activity to making better decisions.

### Track

Record income, expenses, accounts, and recurring transactions.

### Understand

Show spending patterns, budgets, cash flow, and trends.

### Forecast

Predict upcoming balances, spending, and goal progress.

### Decide

Help users answer questions such as:

- Can I afford this?
- Can I save more?
- When will I reach my goal?
- What happens if my expenses increase?
- Why did I spend more this month?

---

## 3. Target Users

Initial target:

- Young professionals
- Freelancers
- Students with regular income
- People starting to budget
- People who want a simple alternative to complex finance apps

Primary use case:

> "I want to know how much money I actually have available to spend."

---

## 4. Core Features

### 4.1 Authentication

Users should be able to create and manage their accounts.

#### Features

- Sign up
- Login
- Logout
- Password reset
- OAuth login (optional)
- Profile
- Currency preference
- Timezone preference

---

## 5. Accounts

Users can manage multiple financial accounts.

### Examples

- Cash
- Bank account
- GCash
- Maya
- Credit card
- Savings account

### Account fields

| Field |
|---|
| `id` |
| `user_id` |
| `name` |
| `type` |
| `balance` |
| `currency` |
| `created_at` |
| `updated_at` |

### Features

- Create account
- Edit account
- Delete account
- View balance
- Account transaction history

---

## 6. Transactions

Transactions are the core data of the application.

### Transaction types

- Income
- Expense
- Transfer

### Transaction fields

| Field |
|---|
| `id` |
| `user_id` |
| `account_id` |
| `category_id` |
| `amount` |
| `type` |
| `description` |
| `date` |
| `created_at` |
| `updated_at` |

### Features

- Add transaction
- Edit transaction
- Delete transaction
- Categorize transaction
- Search transactions
- Filter transactions
- Sort transactions
- View transaction history

---

## 7. Categories

Default categories should be provided while allowing users to customize them.

### Example expense categories

- Food
- Transportation
- Bills
- Shopping
- Entertainment
- Health
- Education
- Subscriptions
- Housing
- Other

### Example income categories

- Salary
- Freelance
- Business
- Investment
- Gift
- Other

### Features

- Create category
- Edit category
- Delete category
- Choose category color
- Choose category icon

---

## 8. Dashboard

The dashboard is the user's financial command center.

### Main metrics

- Current Balance
- Monthly Income
- Monthly Expenses
- Monthly Savings
- Safe to Spend

### Dashboard sections

#### Financial summary

Show the current financial state.

#### Cash flow

Show income and expenses over time.

#### Spending breakdown

Show spending by category.

#### Budget health

Show current budget progress.

#### Recent transactions

Show the latest transactions.

#### Upcoming expenses

Show upcoming financial commitments.

#### Savings goals

Show active goals and progress.

#### Financial insights

Show important observations about the user's finances.

---

## 9. Safe to Spend ⭐

This is one of the core differentiating features.

Instead of showing only the user's current balance, calculate how much money is
realistically available.

### Basic calculation

```text
Current Balance
+ Expected Income
- Upcoming Expenses
- Planned Savings
- Debt Payments
----------------
Safe to Spend
```

### Example

```text
Current balance       ₱42,000
Expected income       ₱15,000
Upcoming bills       -₱18,500
Savings target       -₱10,000
Debt payments         -₱5,000
--------------------------------
Safe to spend         ₱23,500
```

### UX

Display prominently:

```text
🟢 Safe to spend: ₱23,500
```

The number should update whenever relevant financial data changes.

---

## 10. Money Timeline ⭐

The Money Timeline shows future financial events chronologically.

### Example

```text
TODAY
│
├── Sep 10
│   Salary              +₱35,000
│
├── Sep 12
│   Rent                -₱15,000
│
├── Sep 15
│   Credit Card         -₱8,500
│
├── Sep 20
│   Freelance           +₱12,000
│
└── Sep 25
    Internet             -₱1,800
```

### Features

- Upcoming income
- Upcoming expenses
- Recurring payments
- Bill reminders
- Projected balance
- Timeline filtering

---

## 11. Budgets

Users can create monthly spending budgets.

### Example

| Category | Spent | Budget |
|---|---|---|
| Food | ₱7,200 | ₱10,000 |
| Transportation | ₱4,800 | ₱4,000 |
| Entertainment | ₱2,100 | ₱3,000 |
| Shopping | ₱5,400 | ₱5,000 |

### Features

- Create budget
- Edit budget
- Delete budget
- Category-based budgets
- Monthly budgets
- Budget progress
- Budget warnings

---

## 12. Budget Forecasting

> [!NOTE]
> **V2 feature.**

Instead of showing only current spending, estimate where the user will finish.

### Example

**Food**

```text
Spent:
₱7,200

Budget:
₱10,000

Projected:
₱11,400

⚠ You may exceed your budget by ₱1,400.
```

The forecast should consider:

- Days elapsed
- Current spending rate
- Historical spending
- Remaining budget

---

## 13. Savings Goals

Users can create financial goals.

### Example

| Goal | Saved | Target |
|---|---|---|
| Emergency Fund | ₱35,000 | ₱100,000 |
| Japan Trip | ₱42,000 | ₱120,000 |
| New Laptop | ₱25,000 | ₱70,000 |

### Features

- Create goal
- Set target amount
- Set target date
- Track progress
- Add contributions
- View projected completion date

---

## 14. Goal Impact

> [!NOTE]
> **V2 feature.**

Connect spending decisions to savings goals.

### Example

```text
You spent ₱1,500 more on shopping this month.

Your Japan Trip goal is now projected
to be completed 9 days later.
```

This creates a connection between:

**Spending → Savings → Future**

---

## 15. Recurring Transactions

> [!NOTE]
> **V2 feature.**

Users can define recurring income and expenses.

### Examples

- Salary
- Rent
- Internet
- Netflix
- Spotify
- Insurance
- Loan payment
- Phone bill

### Fields

| Field |
|---|
| `amount` |
| `frequency` |
| `start_date` |
| `next_date` |
| `category` |
| `account` |
| `description` |

### Frequencies

- Weekly
- Biweekly
- Monthly
- Quarterly
- Yearly

---

## 16. Reports

Reports help users understand their historical financial behavior.

### Reports

- Income
- Expenses
- Savings
- Cash flow
- Spending by category
- Monthly comparison
- Category trends

### Filters

- This month
- Last month
- Last 3 months
- Last 6 months
- This year
- Custom date range

---

## 17. Monthly Insights

> [!NOTE]
> **V2 feature.**

Automatically explain meaningful changes.

### Example

> Your spending increased by ₱4,320 compared with August.
>
> The biggest increase came from Shopping, which increased by ₱2,800.

### Possible insights

- Spending increased
- Income decreased
- Savings increased
- Category spending changed significantly
- Budget exceeded
- Unusual transaction
- Goal progress improved

---

## 18. What-If Scenarios ⭐

> [!NOTE]
> **V2 feature.**

Allow users to simulate financial decisions.

### Example

User asks:

> What if I save ₱5,000 more every month?

The app responds:

**Current plan**

```text
Emergency fund:
₱50,000 → ₱100,000
8 months
```

**New plan**

```text
Emergency fund:
₱50,000 → ₱100,000
5 months
```

```text
Goal reached approximately
3 months earlier.
```

### Other scenarios

- What if rent increases?
- What if I earn ₱10,000 more?
- What if I spend ₱5,000 less?
- What if I stop a subscription?
- What if I increase savings?
- Can I afford a new purchase?

---

## 19. Financial Health

> [!NOTE]
> **V3 feature.**

Provide a breakdown rather than a meaningless single score.

| Dimension | Status |
|---|---|
| Cash Flow | 🟢 Strong |
| Budget Control | 🟢 Good |
| Savings | 🟡 Improving |
| Debt | 🟠 Watch |
| Emergency Fund | 🔴 Low |

Potential metrics:

- Savings rate
- Expense-to-income ratio
- Emergency fund coverage
- Debt-to-income ratio
- Budget adherence
- Monthly cash flow

---

## 20. Notifications

> [!NOTE]
> **V2 feature.**

### Notifications

- Budget approaching limit
- Budget exceeded
- Upcoming bill
- Goal milestone
- Low safe-to-spend amount
- Unusual spending
- Recurring payment

---

## 21. AI Features

> [!NOTE]
> **V3 feature.**

AI should enhance the application rather than become the main product.

### Smart categorization

Automatically categorize transactions.

### Natural language transactions

User enters:

```text
Spent ₱450 on lunch
```

Application creates:

```text
Amount: ₱450
Category: Food
Type: Expense
Date: Today
```

### Financial assistant

Users can ask:

> - Where did most of my money go this month?
> - Can I afford ₱8,000 headphones?
> - Why did I spend more this month?
> - How much can I save?

The assistant should only use the user's own financial data.

---

## 22. Data Model

Initial Supabase schema:

```text
profiles
├── id
├── name
├── currency
├── timezone
├── created_at
└── updated_at

accounts
├── id
├── user_id
├── name
├── type
├── balance
├── currency
├── created_at
└── updated_at

categories
├── id
├── user_id
├── name
├── type
├── color
├── icon
├── created_at
└── updated_at

transactions
├── id
├── user_id
├── account_id
├── category_id
├── amount
├── type
├── description
├── date
├── created_at
└── updated_at

budgets
├── id
├── user_id
├── category_id
├── amount
├── period
├── created_at
└── updated_at

goals
├── id
├── user_id
├── name
├── target_amount
├── current_amount
├── target_date
├── created_at
└── updated_at

recurring_transactions
├── id
├── user_id
├── account_id
├── category_id
├── amount
├── type
├── frequency
├── next_date
├── description
├── created_at
└── updated_at
```

### Tables at a glance

The same schema in tabular form, for readability. The ASCII trees above are the
spec's original representation and remain authoritative for this document.

#### `profiles`

| Field |
|---|
| `id` |
| `name` |
| `currency` |
| `timezone` |
| `created_at` |
| `updated_at` |

#### `accounts`

| Field |
|---|
| `id` |
| `user_id` |
| `name` |
| `type` |
| `balance` |
| `currency` |
| `created_at` |
| `updated_at` |

#### `categories`

| Field |
|---|
| `id` |
| `user_id` |
| `name` |
| `type` |
| `color` |
| `icon` |
| `created_at` |
| `updated_at` |

#### `transactions`

| Field |
|---|
| `id` |
| `user_id` |
| `account_id` |
| `category_id` |
| `amount` |
| `type` |
| `description` |
| `date` |
| `created_at` |
| `updated_at` |

#### `budgets`

| Field |
|---|
| `id` |
| `user_id` |
| `category_id` |
| `amount` |
| `period` |
| `created_at` |
| `updated_at` |

#### `goals`

| Field |
|---|
| `id` |
| `user_id` |
| `name` |
| `target_amount` |
| `current_amount` |
| `target_date` |
| `created_at` |
| `updated_at` |

#### `recurring_transactions`

| Field |
|---|
| `id` |
| `user_id` |
| `account_id` |
| `category_id` |
| `amount` |
| `type` |
| `frequency` |
| `next_date` |
| `description` |
| `created_at` |
| `updated_at` |

---

## 23. Tech Stack

### Frontend

- Next.js
- TypeScript
- React
- Tailwind CSS
- shadcn/ui
- Recharts or another charting library

### Backend

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Row Level Security
- Supabase Storage if needed

### Deployment

- Vercel
- Supabase

---

## 24. Security

Financial data is sensitive.

The application should use:

- Supabase Row Level Security
- User-scoped database queries
- Server-side validation
- Input validation
- Secure authentication
- No client-side trust for ownership checks
- Proper database constraints
- Audit logging where appropriate

Every financial record must belong to a user.

Example:

```sql
user_id = auth.uid()
```

RLS policies should prevent users from accessing another user's data.

---

## 25. Application Structure

Recommended navigation:

- Dashboard
- Transactions
- Budget
- Goals
- Timeline
- Accounts
- Reports
- What If?
- Settings

Primary CTA:

- `+ Add Transaction`

---

## 26. MVP Scope

The first version should focus on the following:

| Area | Items |
|---|---|
| **Authentication** | Sign up · Login · Logout |
| **Accounts** | Create account · Edit account · Delete account · View balance |
| **Transactions** | Add income · Add expense · Edit transaction · Delete transaction · Categories · Search/filter |
| **Dashboard** | Balance · Income · Expenses · Savings · Cash flow chart · Spending breakdown · Recent transactions |
| **Budgets** | Monthly category budgets · Budget progress |
| **Goals** | Create savings goal · Track progress |
| **Core Differentiators** | Safe to Spend · Money Timeline |

---

## 27. V2 Roadmap

After MVP:

- Recurring transactions
- Budget forecasting
- Upcoming bills
- Expected income
- Monthly insights
- Goal forecasting
- Goal impact
- Notifications
- CSV import/export
- What-If scenarios
- Better reports

---

## 28. V3 Roadmap

Long-term:

- AI transaction categorization
- Natural language transaction entry
- Financial assistant
- Financial health analysis
- Subscription detection
- Debt planner
- Investment tracking
- Shared household budgets
- Bank integrations
- Mobile/PWA improvements

---

## 29. Product Differentiators

The application should not compete solely on:

> "We track your expenses."

Instead, the key differentiators are:

### 1. Safe to Spend

How much can I actually spend?

### 2. Money Timeline

What's going to happen to my money next?

### 3. Forecasting

Where will I end up if I continue spending like this?

### 4. What-If

What happens if I change my financial behavior?

### 5. Goal Impact

How do my current decisions affect my future goals?

---

## 30. Core User Journey

```text
Sign Up
   ↓
Create Accounts
   ↓
Add Income
   ↓
Add Expenses
   ↓
Create Budgets
   ↓
Create Savings Goals
   ↓
Dashboard
   ↓
Safe to Spend
   ↓
Money Timeline
   ↓
Forecast
   ↓
Make Better Decisions
```

---

## 31. Success Criteria

The MVP should allow a user to answer these questions quickly:

1. How much money do I have?
2. How much did I earn this month?
3. How much did I spend?
4. Where did my money go?
5. How much can I safely spend?
6. What bills are coming up?
7. Am I staying within my budget?
8. How much have I saved?
9. Am I on track for my savings goal?

If the application can answer these questions clearly, the MVP is successful.

---

## 32. Brand Direction

### Name

Where'd My Money Go

### Slug

`whered-my-money-go`

### Tone

- Playful
- Friendly
- Slightly goofy
- Non-judgmental
- Simple
- Modern

The application can use humor without making financial information feel
unserious.

### Example copy

> "Your wallet survived another month. Barely."
>
> "You spent ₱2,400 on food. We won't judge."
>
> "Hala. You're getting close to your shopping budget."
>
> "Good news: future-you still has money."

---

## 33. MVP Principle

Don't build everything. Build the smallest product that makes the user say:

> "Ohhh. Now I know where my money is going."

The initial product should prioritize clarity and useful financial decisions
over the number of features.
