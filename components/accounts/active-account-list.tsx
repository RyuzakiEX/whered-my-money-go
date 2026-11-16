'use client';

// The active accounts and their total, with optimistic archiving (M2-F03).
//
// Archiving hides the card at once (useOptimistic) and calls the action. On
// success the server's refresh drops the account for real; on a refusal the
// transition ends, the optimistic state falls away, and the card comes back
// — the rollback — with the reason in a toast. A request that failed outright
// may still have archived it, so that case refreshes instead of guessing.
// The total is never adjusted here: it is computed on the server
// (state-and-caching.md#optimistic-ui), so while an action is in flight it is
// only marked busy.

import { useOptimistic, useRef, type ReactNode } from 'react';

import type { Account } from '@/lib/core/types';

import { AccountActionsMenu } from './account-actions-menu';
import { AccountCard } from './account-card';
import type { AccountActionResult } from './action-result';
import { useArchiveWithUndo } from './use-archive-with-undo';

type IdAction = (id: string) => Promise<AccountActionResult>;

const NO_HIDDEN: ReadonlySet<string> = new Set();

export function ActiveAccountList({
  accounts,
  total,
  archiveAction,
  restoreAction,
  deleteAction,
}: {
  accounts: readonly Account[];
  /** The server-rendered total, marked busy while an action is in flight. */
  total: ReactNode;
  archiveAction: IdAction;
  restoreAction: IdAction;
  deleteAction: IdAction;
}) {
  const [hidden, hide] = useOptimistic(
    NO_HIDDEN,
    (current: ReadonlySet<string>, id: string) => new Set(current).add(id),
  );
  const { archive, pending } = useArchiveWithUndo();
  // Where focus goes when the card it was on leaves the list.
  const headingRef = useRef<HTMLHeadingElement>(null);

  function focusHeading() {
    requestAnimationFrame(() => {
      headingRef.current?.focus();
    });
  }

  const visible = accounts.filter((account) => !hidden.has(account.id));

  return (
    <>
      <div
        aria-busy={pending || undefined}
        className={pending ? 'opacity-60 transition-opacity' : undefined}
      >
        {total}
      </div>
      <section aria-labelledby="active-heading" className="flex flex-col gap-3">
        <h2
          id="active-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-medium outline-none"
        >
          Your accounts
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((account) => (
            <li key={account.id} className="flex">
              <AccountCard
                account={account}
                actions={
                  <AccountActionsMenu
                    accountName={account.name}
                    onArchive={() => {
                      // The menu closes onto a trigger about to disappear.
                      focusHeading();
                      archive(
                        account.name,
                        () => archiveAction(account.id),
                        () => restoreAction(account.id),
                        () => {
                          hide(account.id);
                        },
                      );
                    }}
                    deleteAction={() => deleteAction(account.id)}
                    onDeleted={focusHeading}
                  />
                }
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
