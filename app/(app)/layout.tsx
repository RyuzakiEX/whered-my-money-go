// The authenticated app shell (M0-F02, M1-F04). A Server Component: the
// client boundaries are only NavLink (active route), MobileNav (drawer
// state), AccountMenu, and ThemeToggle — see
// docs/architecture/frontend-architecture.md.
//
// proxy.ts already sends a signed-out visitor to /login. This layout checks
// again, because a matcher change could silently skip the proxy, and a page
// must never render for nobody.

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AccountMenu } from '@/components/shell/account-menu';
import { AddTransactionButton } from '@/components/shell/add-transaction-button';
import { MobileNav } from '@/components/shell/mobile-nav';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { signOut } from '@/lib/server/actions/auth';
import { displayNameOf, getProfile } from '@/lib/server/queries/profile';

/** Form action for the menu's Log out. signOut redirects to /login. */
async function signOutFromForm(): Promise<void> {
  'use server';
  await signOut();
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect('/login');

  const account = (
    <AccountMenu
      name={displayNameOf(profile)}
      email={profile.email}
      signOutAction={signOutFromForm}
    />
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop: persistent sidebar from 768px up. */}
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <span className="px-3 text-base font-semibold">
          Where&apos;d My Money Go
        </span>
        <AddTransactionButton />
        <SidebarNav />
        <div className="mt-auto flex flex-col gap-2">
          {account}
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: top bar with the drawer trigger, and the CTA kept within
            thumb reach. */}
        <header className="flex items-center gap-2 border-b p-2 md:hidden">
          <MobileNav>
            <div className="flex h-full flex-col gap-4">
              <SidebarNav />
              <div className="mt-auto">{account}</div>
            </div>
          </MobileNav>
          <span className="flex-1 truncate font-semibold">
            Where&apos;d My Money Go
          </span>
          <ThemeToggle />
        </header>

        <main className="flex-1 p-6">{children}</main>

        <div className="sticky bottom-0 border-t bg-background p-3 md:hidden">
          <AddTransactionButton />
        </div>
      </div>
    </div>
  );
}
