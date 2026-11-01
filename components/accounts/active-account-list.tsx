'use client';

// The active accounts and their total, with optimistic archiving (M2-F03).
//
// Archiving hides the card at once (useOptimistic) and calls the action. On
// success the server's refresh drops the account for real; on failure the
// transition ends, the optimistic state falls away, and the card comes back
// — the rollback — with the reason in a toast. The total is never adjusted
// here: it is computed on the server (state-and-caching.md#optimistic-ui),
// so while an archive is in flight it is only marked busy.

import { useOptimistic, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { Account } from '@/lib/core/types';

import { AccountActionsMenu } from './account-actions-menu';
import { AccountCard } from './account-card';
import type { AccountActionResult } from './action-result';

type IdAction = (id: string) => Promise<AccountActionResult>;

const NO_HIDDEN: ReadonlySet<string> = new Set();
const NETWORK_FAILURE =
  "We couldn't reach the server, so nothing changed. Try again.";

async function settle(
  action: IdAction,
  id: string,
): Promise<AccountActionResult> {
  try {
    return await action(id);
  } catch {
    return { ok: false, message: NETWORK_FAILURE };
  }
}

export function ActiveAccountList({
  accounts,
  total,
  archiveAction,
  restoreAction,
  deleteAction,
}: {
  accounts: readonly Account[];
  /** The server-rendered total, marked busy while an archive is in flight. */
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

  function undo({ id, name }: Account) {
    void settle(restoreAction, id).then((result) => {
      if (result.ok) toast.success(`${name} is back.`);
      else toast.error(result.message);
    });
  }

  function archive(account: Account) {
    startTransition(async () => {
      hide(account.id);
      const result = await settle(archiveAction, account.id);
      if (result.ok) {
        toast.success(`${account.name} archived. It's resting, not gone.`, {
          action: {
            label: 'Undo',
            onClick: () => {
              undo(account);
            },
          },
        });
      } else {
        toast.error(result.message);
      }
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
        <h2 id="active-heading" className="text-lg font-medium">
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
