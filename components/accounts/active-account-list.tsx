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

import { useRouter } from 'next/navigation';
import { useOptimistic, useRef, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { Account } from '@/lib/core/types';

import { AccountActionsMenu } from './account-actions-menu';
import { AccountCard } from './account-card';
import { settle, type AccountActionResult } from './action-result';

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
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // Where focus goes when the card it was on leaves the list.
  const headingRef = useRef<HTMLHeadingElement>(null);

  function focusHeading() {
    requestAnimationFrame(() => {
      headingRef.current?.focus();
    });
  }

  function report(result: AccountActionResult, success: () => void) {
    if (result.ok) {
      success();
      return;
    }
    toast.error(result.message);
    if (result.unconfirmed) router.refresh();
  }

  function undo({ id, name }: Account) {
    startTransition(async () => {
      const result = await settle(() => restoreAction(id));
      report(result, () => toast.success(`${name} is back.`));
    });
  }

  function archive(account: Account) {
    // The menu closes onto a trigger that is about to disappear.
    focusHeading();
    startTransition(async () => {
      hide(account.id);
      const result = await settle(() => archiveAction(account.id));
      report(result, () =>
        toast.success(`${account.name} archived. It's resting, not gone.`, {
          action: {
            label: 'Undo',
            onClick: () => {
              undo(account);
            },
          },
        }),
      );
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
                      archive(account);
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
