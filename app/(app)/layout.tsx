// The authenticated app shell (M0-F02). A Server Component: the client
// boundaries are only NavLink (active route), MobileNav (drawer state), and
// ThemeToggle — see docs/architecture/frontend-architecture.md.
//
// Auth is not enforced yet; the (app) group gains its redirect in M1.

import type { ReactNode } from 'react';

import { AddTransactionButton } from '@/components/shell/add-transaction-button';
import { MobileNav } from '@/components/shell/mobile-nav';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* Desktop: persistent sidebar from 768px up. */}
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <span className="px-3 text-base font-semibold">
          Where&apos;d My Money Go
        </span>
        <AddTransactionButton />
        <SidebarNav />
        <div className="mt-auto">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: top bar with the drawer trigger, and the CTA kept within
            thumb reach. */}
        <header className="flex items-center gap-2 border-b p-2 md:hidden">
          <MobileNav>
            <SidebarNav />
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
