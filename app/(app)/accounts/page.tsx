// The accounts list (M2-F01): the screen that answers spec §31 Q1, "How much
// money do I have?" (docs/product/success-criteria.md #1).
//
// A Server Component. The total is computed here by lib/core and arrives in
// the markup as a formatted string; no component adds money up.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AccountActionsMenu } from '@/components/accounts/account-actions-menu';
import { AccountCard } from '@/components/accounts/account-card';
import { AccountDialog } from '@/components/accounts/account-dialog';
import { ActiveAccountList } from '@/components/accounts/active-account-list';
import { RestoreAccountButton } from '@/components/accounts/restore-account-button';
import { cn } from '@/components/ui/cn';
import { spendableBalanceMinor } from '@/lib/core/accounts/spendable-balance';
import { MixedCurrencyError } from '@/lib/core/money/arithmetic';
import type { Minor } from '@/lib/core/money/parse';
import { listAccounts } from '@/lib/server/queries/accounts';
import { getProfile } from '@/lib/server/queries/profile';
import { formatMoney } from '@/lib/utils/format-money';

import { archive, create, remove, restore } from './actions';

export const metadata: Metadata = { title: 'Accounts' };

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Independent reads, in parallel. One accounts query serves both lists:
  // the archived count decides whether the toggle appears at all.
  const [profile, search, accounts] = await Promise.all([
    getProfile(),
    searchParams,
    listAccounts({ includeArchived: true }),
  ]);
  if (!profile) redirect('/auth/signout');

  // `?archived=1` shows archived accounts; anything else is the default view,
  // so a hand-edited URL falls back instead of erroring.
  const showArchived = search['archived'] === '1';

  const active = accounts.filter((account) => account.archivedAt === null);
  const archived = accounts.filter((account) => account.archivedAt !== null);
  const excludedCount = active.filter((a) => a.excludeFromSafeToSpend).length;
  const spendableCount = active.length - excludedCount;

  let totalMinor: Minor | null;
  try {
    totalMinor = spendableBalanceMinor(active, profile.currency);
  } catch (error) {
    // An account in another currency than the profile's (possible after a
    // currency change in Settings). Show no total rather than a wrong one.
    if (!(error instanceof MixedCurrencyError)) throw error;
    totalMinor = null;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Focusable from script: where focus lands after a delete removes
            the card it was on (AccountActionsMenu). */}
        <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
          Accounts
        </h1>
        {active.length > 0 ? (
          <AccountDialog
            mode="create"
            currency={profile.currency}
            saveAction={create}
          />
        ) : null}
      </div>

      {active.length === 0 ? (
        <section
          aria-labelledby="empty-heading"
          className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6"
        >
          {archived.length === 0 ? (
            <>
              <h2 id="empty-heading" className="text-lg font-medium">
                No accounts yet. Let&apos;s fix that.
              </h2>
              <p className="text-muted-foreground">
                An account is anywhere your money lives: your wallet, a bank,
                GCash. Add one and we&apos;ll keep count.
              </p>
            </>
          ) : (
            <>
              <h2 id="empty-heading" className="text-lg font-medium">
                No active accounts right now.
              </h2>
              <p className="text-muted-foreground">
                Everything you have is archived. Restore an account below, or
                add a new one.
              </p>
            </>
          )}
          <AccountDialog
            mode="create"
            currency={profile.currency}
            saveAction={create}
          />
        </section>
      ) : (
        <ActiveAccountList
          accounts={active}
          archiveAction={archive}
          restoreAction={restore}
          deleteAction={remove}
          total={
            <section
              aria-labelledby="total-heading"
              className="flex flex-col gap-1 rounded-xl bg-card p-6 ring-1 ring-foreground/10"
            >
              <h2
                id="total-heading"
                className="text-sm font-medium text-muted-foreground"
              >
                Spendable total
              </h2>
              {totalMinor === null ? (
                <p className="text-base">
                  Some of your accounts aren&apos;t in {profile.currency}, your
                  profile currency, so we can&apos;t add them into one total.
                  Each account still shows its own balance.
                </p>
              ) : (
                <>
                  <p
                    data-testid="spendable-total"
                    className={cn(
                      'text-4xl font-semibold tabular-nums',
                      totalMinor < 0 && 'text-destructive',
                    )}
                  >
                    {formatMoney(totalMinor, profile.currency)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {spendableCount === 0
                      ? 'All your accounts are set aside, so none count as spendable.'
                      : `Across ${plural(spendableCount, 'account you can spend from', 'accounts you can spend from')}.`}
                    {spendableCount > 0 && excludedCount > 0
                      ? ` ${plural(excludedCount, 'set-aside account is', 'set-aside accounts are')} not counted.`
                      : null}
                  </p>
                </>
              )}
            </section>
          }
        />
      )}

      {archived.length > 0 ? (
        <section
          aria-labelledby="archived-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="archived-heading" className="text-lg font-medium">
              Archived ({archived.length})
            </h2>
            <Link
              href={showArchived ? '/accounts' : '/accounts?archived=1'}
              scroll={false}
              className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
            >
              {showArchived
                ? 'Hide archived accounts'
                : 'Show archived accounts'}
            </Link>
          </div>
          {showArchived ? (
            <>
              <p className="text-sm text-muted-foreground">
                Archived accounts keep their history but stay out of your
                totals, pickers, and Safe to Spend.
              </p>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {archived.map((account) => (
                  <li key={account.id} className="flex">
                    <AccountCard
                      account={account}
                      actions={
                        <>
                          <RestoreAccountButton
                            accountName={account.name}
                            restoreAction={restore.bind(null, account.id)}
                          />
                          <AccountActionsMenu
                            accountName={account.name}
                            deleteAction={remove.bind(null, account.id)}
                          />
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
