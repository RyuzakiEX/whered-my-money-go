'use client';

// The account menu (M1-F04). The trigger names the user in text, never an
// avatar alone; the menu holds Settings and Log out.
//
// Radix's dropdown provides the keyboard contract the task asks for:
// aria-expanded on the trigger, open on click / Enter / Space, close on Escape
// and outside click, arrow keys between items, focus back on the trigger.

import { ChevronsUpDownIcon, LogOutIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function AccountMenu({
  name,
  email,
  signOutAction,
}: {
  name: string;
  email: string;
  /** A sign-out Server Action, passed in: components may not import lib/server. */
  signOutAction: () => Promise<void>;
}) {
  // The menu renders inside this wrapper rather than at the end of <body>, so
  // it stays within the sidebar's (or drawer's) landmark — axe's `region`.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  return (
    <div ref={setContainer}>
      {/* Non-modal: the WAI-ARIA menu button pattern does not hide the page.
          A modal menu marks everything else aria-hidden, which axe flags
          (aria-hidden-focus, and the page seeming to lose its main and h1). */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-11 w-full justify-between gap-2 px-3"
            aria-label={`Account menu for ${name}`}
          >
            <span className="truncate">{name}</span>
            <ChevronsUpDownIcon className="size-4 shrink-0" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56"
          container={container}
        >
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/profile">
              <SettingsIcon aria-hidden />
              Settings
            </Link>
          </DropdownMenuItem>
          {/* A real form, so logging out works without JavaScript too. */}
          <form action={signOutAction}>
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full">
                <LogOutIcon aria-hidden />
                Log out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
