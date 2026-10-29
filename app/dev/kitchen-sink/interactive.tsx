'use client';

// Client boundary justification: interaction (toasts fire from click
// handlers; overlay triggers need open/close state).

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const TRIGGER_STATES = [
  ['default', {}],
  ['hover', { 'data-force-state': 'hover' }],
  ['focus', { 'data-force-state': 'focus' }],
  ['disabled', { disabled: true }],
] as const;

export function OverlayDemos() {
  return (
    <div className="flex flex-col gap-3">
      {TRIGGER_STATES.map(([state, props]) => (
        <div key={state} className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-sm text-muted-foreground">{state}</span>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" {...props}>
                Dialog
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete transaction?</DialogTitle>
                <DialogDescription>
                  Groceries, − ₱1,845.50 on 27 Oct. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="destructive">Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" {...props}>
                Sheet
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>
                  Narrow the transaction list.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline" {...props}>
                Drawer
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Safe to Spend breakdown</DrawerTitle>
                <DrawerDescription>
                  How ₱4,210.00 was worked out.
                </DrawerDescription>
              </DrawerHeader>
            </DrawerContent>
          </Drawer>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" {...props}>
                Popover
              </Button>
            </PopoverTrigger>
            <PopoverContent>Due 14 Nov · ₱2,500.00</PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" {...props}>
                Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Transaction</DropdownMenuLabel>
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );
}

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => toast.success('Transaction saved')}
      >
        Success
      </Button>
      <Button variant="outline" onClick={() => toast.error('Could not save')}>
        Error
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info('Budget resets on the 1st')}
      >
        Info
      </Button>
    </div>
  );
}
