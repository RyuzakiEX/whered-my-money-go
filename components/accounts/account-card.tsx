// One account on the accounts list (M2-F01). A Server Component.
//
// The card has exactly one link, the account's name, stretched over the whole
// card with an ::after overlay, so the entire card is clickable while the
// accessibility tree holds a single named link. Controls (restore here, the
// action menu in M2-F03) sit above the overlay as siblings of the link, never
// inside it: an interactive element nested in a link is announced unreliably
// and cannot be reached by keyboard in every browser.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import type { Account } from '@/lib/core/types';
import { formatMoney } from '@/lib/utils/format-money';

import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS } from './account-types';

export function AccountCard({
  account,
  actions,
}: {
  account: Account;
  /** Controls shown on the card, above the link overlay. */
  actions?: ReactNode;
}) {
  const Icon = ACCOUNT_TYPE_ICONS[account.type];
  const archived = account.archivedAt !== null;
  const negative = account.balanceMinor < 0;

  return (
    <article
      className={cn(
        'relative flex w-full flex-col gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10',
        'has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50',
        archived &&
          'bg-muted/40 ring-0 outline-1 outline-border outline-dashed',
      )}
      data-archived={archived ? true : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted',
            archived && 'opacity-60',
          )}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-base font-medium">
            <Link
              href={`/accounts/${account.id}`}
              className="outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              {account.name}
            </Link>
          </h3>
          <p className="text-sm text-muted-foreground">
            {ACCOUNT_TYPE_LABELS[account.type]}
            {archived ? ' · Archived' : null}
          </p>
        </div>
      </div>

      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          negative && 'text-destructive',
          archived && !negative && 'text-muted-foreground',
        )}
      >
        <span className="sr-only">Balance: </span>
        {formatMoney(account.balanceMinor, account.currency)}
      </p>

      {account.excludeFromSafeToSpend || actions ? (
        <div className="flex flex-wrap items-center gap-2">
          {account.excludeFromSafeToSpend ? (
            <Badge variant="secondary">Not counted in Safe to Spend</Badge>
          ) : null}
          {actions ? (
            // Above the link's overlay, so these stay clickable.
            <div className="relative z-10 ml-auto flex items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
