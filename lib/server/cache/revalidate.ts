// Named invalidation helpers — one per kind of mutation. Every Server Action
// calls exactly one, so an action states intent rather than plumbing, and the
// invalidation matrix in docs/architecture/state-and-caching.md is checked by
// unit test against these.
//
// MAY BE IMPORTED BY: lib/server/actions/**.
//
// `updateTag`, not `revalidateTag`: in Next 16, updateTag is the Server Action
// API for read-your-own-writes — it expires the entry at once, so the next
// request recomputes. revalidateTag(tag, 'max') may serve stale content while
// it revalidates, and a user who just changed their currency must not see the
// old one on reload.

import { updateTag } from 'next/cache';

import { tags, type TagName } from './tags';

/** Which tags each mutation invalidates — the matrix, as data. */
export const INVALIDATES: Readonly<
  Record<
    'profileChange' | 'accountChange' | 'accountRemoval',
    readonly TagName[]
  >
> = {
  // Currency and timezone feed every formatted amount and every
  // calendar-date calculation, so a profile change invalidates everything.
  profileChange: [
    'accounts',
    'transactions',
    'categories',
    'budgets',
    'goals',
    'recurring',
    'dashboard',
    'sts',
    'timeline',
    'profile',
  ],
  // "Create / update account": a new or edited account moves the balances,
  // the totals, Safe to Spend, and the Timeline's starting balance.
  accountChange: ['accounts', 'dashboard', 'sts', 'timeline'],
  // "Archive / delete account": also the transactions and recurring rules
  // that hang off the account, which leave every list with it.
  accountRemoval: [
    'accounts',
    'transactions',
    'recurring',
    'dashboard',
    'sts',
    'timeline',
  ],
};

export function revalidateForProfileChange(userId: string): void {
  for (const name of INVALIDATES.profileChange) {
    updateTag(tags[name](userId));
  }
}

export function revalidateForAccountChange(userId: string): void {
  for (const name of INVALIDATES.accountChange) {
    updateTag(tags[name](userId));
  }
}

/** Archive, restore, and delete: restoring undoes an archive, same row. */
export function revalidateForAccountRemoval(userId: string): void {
  for (const name of INVALIDATES.accountRemoval) {
    updateTag(tags[name](userId));
  }
}
