// An account's own page (M2-F04). A Server Component.
//
// getAccount answers null for an account that does not exist, was deleted,
// or is another user's, and all three render the same not-found page: the
// page cannot be used to learn whether an id is someone else's.

import { ArchiveIcon, ChevronLeftIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AccountDetailActions } from '@/components/accounts/account-detail-actions';
import {
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_LABELS,
} from '@/components/accounts/account-types';
import { RestoreAccountButton } from '@/components/accounts/restore-account-button';
import { AddTransactionButton } from '@/components/shell/add-transaction-button';
import { cn } from '@/components/ui/cn';
import { getAccount } from '@/lib/server/queries/accounts';
import { getProfile } from '@/lib/server/queries/profile';
import { formatInstantAsDate } from '@/lib/utils/format-date';
import { formatMoney } from '@/lib/utils/format-money';

import { archive, removeAndLeave, restore, update } from '../actions';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const account = await getAccount((await params).id);
  return { title: account ? account.name : 'Account not found' };
}

export default async function AccountPage({ params }: Props) {
  const { id } = await params;
  const [profile, account] = await Promise.all([getProfile(), getAccount(id)]);
  if (!profile) redirect('/auth/signout');
  if (!account) notFound();

  const Icon = ACCOUNT_TYPE_ICONS[account.type];
  const archived = account.archivedAt !== null;
  const negative = account.balanceMinor < 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <nav aria-label="Breadcrumb">
        <Link
          href="/accounts"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:underline"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          All accounts
        </Link>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon aria-hidden className="size-6" />
          </span>
          <div className="flex min-w-0 flex-col">
            {/* Focusable from script: where focus lands after an action
                removes the control it was on. */}
            <h1
              tabIndex={-1}
              className="truncate text-2xl font-semibold outline-none"
            >
              {account.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {ACCOUNT_TYPE_LABELS[account.type]}
            </p>
          </div>
        </div>
        <AccountDetailActions
          account={account}
          updateAction={update.bind(null, account.id)}
          archiveAction={archive.bind(null, account.id)}
          restoreAction={restore.bind(null, account.id)}
          deleteAction={removeAndLeave.bind(null, account.id)}
        />
      </div>

      {archived ? (
        <section
          aria-labelledby="archived-heading"
          className="flex flex-col gap-3 rounded-xl border border-dashed bg-muted/40 p-4 sm:flex-row sm:items-center"
        >
          <ArchiveIcon aria-hidden className="size-5 shrink-0" />
          <div className="flex flex-1 flex-col gap-1">
            <h2 id="archived-heading" className="text-sm font-medium">
              This account is archived
            </h2>
            <p className="text-sm text-muted-foreground">
              It stays out of your totals, pickers, and Safe to Spend, and
              it&apos;s read-only. Restore it to make changes.
            </p>
          </div>
          <RestoreAccountButton
            accountName={account.name}
            restoreAction={restore.bind(null, account.id)}
          />
        </section>
      ) : null}

      <section
        aria-labelledby="balance-heading"
        className="flex flex-col gap-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="balance-heading"
            className="text-sm font-medium text-muted-foreground"
          >
            Current balance
          </h2>
          <p
            data-testid="current-balance"
            className={cn(
              'text-4xl font-semibold tabular-nums',
              negative && 'text-destructive',
            )}
          >
            {formatMoney(account.balanceMinor, account.currency)}
          </p>
          {account.excludeFromSafeToSpend ? (
            <p className="text-sm text-muted-foreground">
              Not counted in Safe to Spend: this money is set aside.
            </p>
          ) : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Opening balance</dt>
          <dd data-testid="opening-balance" className="tabular-nums">
            {formatMoney(account.openingBalanceMinor, account.currency)}
          </dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{ACCOUNT_TYPE_LABELS[account.type]}</dd>
          <dt className="text-muted-foreground">Currency</dt>
          <dd>{account.currency}</dd>
          <dt className="text-muted-foreground">Added</dt>
          <dd>{formatInstantAsDate(account.createdAt, profile.timezone)}</dd>
        </dl>
      </section>

      <section
        aria-labelledby="history-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="history-heading" className="text-lg font-medium">
          Transactions
        </h2>
        {/* Deliberately empty until M3-F02 lists this account's
            transactions here; the heading and region stay put. */}
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <p className="font-medium">No transactions yet.</p>
          <p className="text-sm text-muted-foreground">
            Money in, money out: once you record some for {account.name},
            they&apos;ll show up here.
          </p>
          <AddTransactionButton className="w-auto" />
        </div>
      </section>
    </div>
  );
}
