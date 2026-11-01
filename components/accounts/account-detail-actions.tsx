'use client';

// Edit, Archive, and Delete on an account's own page (M2-F04), reusing the
// dialog (M2-F02) and the menu (M2-F03).
//
// An archived account is read-only until restored — updateAccount refuses to
// change one — so its Edit stays visible but disabled, with the reason
// attached, and its menu offers only Delete. Deleting leaves the page: the
// account it describes is gone.

import { PencilIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { Account } from '@/lib/core/types';
import { formatMinorForInput } from '@/lib/utils/format-money';

import { AccountActionsMenu } from './account-actions-menu';
import { AccountDialog } from './account-dialog';
import type { AccountFormValues, AccountSaveResult } from './account-form';
import { settle, type AccountActionResult } from './action-result';

export const EDIT_DISABLED_REASON = 'Restore this account to edit it.';

export function AccountDetailActions({
  account,
  updateAction,
  archiveAction,
  restoreAction,
  deleteAction,
}: {
  account: Account;
  /** Bound to this account's id by the page. */
  updateAction: (values: AccountFormValues) => Promise<AccountSaveResult>;
  archiveAction: () => Promise<AccountActionResult>;
  restoreAction: () => Promise<AccountActionResult>;
  deleteAction: () => Promise<AccountActionResult>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const archived = account.archivedAt !== null;

  function report(result: AccountActionResult, success: () => void) {
    if (result.ok) success();
    else toast.error(result.message);
    if (!result.ok && result.unconfirmed) router.refresh();
  }

  function archive() {
    startTransition(async () => {
      report(await settle(archiveAction), () =>
        toast.success(`${account.name} archived. It's resting, not gone.`, {
          action: {
            label: 'Undo',
            onClick: () => {
              startTransition(async () => {
                report(await settle(restoreAction), () =>
                  toast.success(`${account.name} is back.`),
                );
              });
            },
          },
        }),
      );
    });
  }

  return (
    <div className="flex items-center gap-2">
      {archived ? (
        // aria-disabled, not disabled: it stays in the tab order, so a
        // keyboard user can reach it and hear why it does nothing.
        // The reason is a sibling, not a child: inside the button it would
        // become part of the button's name.
        <>
          <Button
            variant="outline"
            size="lg"
            className="min-h-11"
            aria-disabled="true"
            aria-describedby="edit-disabled-reason"
          >
            <PencilIcon aria-hidden />
            Edit
          </Button>
          <span id="edit-disabled-reason" className="sr-only">
            {EDIT_DISABLED_REASON}
          </span>
        </>
      ) : (
        <AccountDialog
          mode="edit"
          accountId={account.id}
          // The account's own currency: the balance is parsed in it.
          currency={account.currency}
          initial={{
            name: account.name,
            type: account.type,
            openingBalance: formatMinorForInput(
              account.openingBalanceMinor,
              account.currency,
            ),
            excludeFromSafeToSpend: account.excludeFromSafeToSpend,
          }}
          saveAction={updateAction}
        />
      )}
      <AccountActionsMenu
        accountName={account.name}
        {...(archived ? {} : { onArchive: archive })}
        deleteAction={deleteAction}
        onDeleted={() => {
          router.replace('/accounts');
        }}
      />
    </div>
  );
}
