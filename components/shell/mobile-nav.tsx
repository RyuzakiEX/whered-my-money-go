'use client';

// Client boundary justification: interaction (open/close state).
//
// Below 768px the sidebar becomes this drawer. Sheet (Radix Dialog) provides
// the focus trap, Escape, backdrop click, and focus restore to the trigger.
// This component adds the two closes Radix cannot know about: a route change,
// and choosing the page you are already on.

import { MenuIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState, type MouseEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export function MobileNav({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on route change by comparing with the previous render, not in an
  // effect — React's documented pattern for state derived from a prop
  // ("Adjusting some state when a prop changes").
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // A click on the current page's link changes no route, so close here too.
  function closeOnLinkClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('a')) setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="size-11">
          <MenuIcon aria-hidden />
          <span className="sr-only">Open navigation</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetHeader>
          <SheetTitle>Where&apos;d My Money Go</SheetTitle>
          <SheetDescription className="sr-only">
            Main navigation
          </SheetDescription>
        </SheetHeader>
        {/* Click delegation for the links inside; keyboard activation of a
            link fires the same click event. */}
        <div className="px-4" onClick={closeOnLinkClick}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
