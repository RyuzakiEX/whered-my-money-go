'use client';

// Client boundary justification: the current route. A Server Component layout
// is never told the pathname, so marking the active item (aria-current) needs
// usePathname(). This component does that and nothing else — the sidebar
// around it stays a Server Component.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/** `/transactions/abc` is inside `/transactions`; `/goals-archive` is not inside `/goals`. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({
  href,
  label,
  children,
}: {
  href: string;
  /** Stable label for tests and analytics; the visible text is `children`. */
  label: string;
  children: ReactNode;
}) {
  const active = isActive(usePathname(), href);

  return (
    <Link
      href={href}
      data-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // min-h-11: the 44px touch-target minimum.
        'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors outline-none',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:ring-3 focus-visible:ring-ring',
        // Active is distinct by weight and background, not colour alone.
        active && 'bg-accent font-semibold text-accent-foreground',
      )}
    >
      {children}
    </Link>
  );
}
