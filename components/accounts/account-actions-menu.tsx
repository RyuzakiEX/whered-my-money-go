'use client';

// An account's destructive actions (M2-F03): a menu offering Archive and
// Delete, on each card and on the detail page.
//
// Archive needs no confirmation: it is undoable, and the caller's toast
// offers Undo. Delete is not undoable, so it confirms in an alert dialog that
// names the account — "Delete GCash?" — so a misclick on the wrong card is
// caught. Radix focuses Cancel when the dialog opens, never the destructive
// button, and the dialog stays open until the server answers, so a failure
// is shown where the user is looking.
//
// TODO(M3-B03): the `blocked` result — an account with transactions — turns
// this dialog into "it has N transactions; archive it instead".

import { ArchiveIcon, EllipsisIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { AccountActionResult } from './action-result';

const NETWORK_FAILURE =
  "We couldn't reach the server, so nothing was deleted. Try again.";

export function AccountActionsMenu({
  accountName,
  onArchive,
  deleteAction,
  onDeleted,
}: {
  accountName: string;
  /** Omitted for an archived account, which is restored rather than archived. */
  onArchive?: () => void;
  deleteAction: () => Promise<AccountActionResult>;
  /** After a delete: e.g. leave the deleted account's own page. */
  onDeleted?: () => void;
}) {
  // Inside this wrapper, not at the end of <body>: the menu stays within the
  // page's landmark (axe `region`), as the account menu does.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    setError(undefined);
    startTransition(async () => {
      let result: AccountActionResult;
      try {
        result = await deleteAction();
      } catch {
        result = { ok: false, message: NETWORK_FAILURE };
      }
      if (result.ok) {
        setConfirming(false);
        toast.success(`${accountName} deleted. Clean slate.`);
        onDeleted?.();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div ref={setContainer}>
      {/* Non-modal, as the WAI-ARIA menu button pattern: a modal menu hides
          the rest of the page from assistive tech. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`Actions for ${accountName}`}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" container={container}>
          {onArchive ? (
            <DropdownMenuItem onSelect={onArchive}>
              <ArchiveIcon aria-hidden />
              Archive
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            // Focused, the item takes the accent pair: red on the variant's
            // tint, or on accent, is below AA in the light theme. The icon
            // and the word still say what it does.
            className="data-[variant=destructive]:focus:bg-accent data-[variant=destructive]:focus:text-accent-foreground dark:data-[variant=destructive]:focus:bg-accent"
            onSelect={() => {
              setError(undefined);
              setConfirming(true);
            }}
          >
            <Trash2Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          // A delete in flight finishes where the user can see its outcome.
          if (!open && pending) return;
          setConfirming(open);
        }}
      >
        <AlertDialogContent
          // Opened from a menu item that has since unmounted, so Radix has
          // nothing to return focus to: back to the menu's trigger, or —
          // when the delete took the card with it — to the page heading.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = triggerRef.current;
            requestAnimationFrame(() => {
              if (trigger?.isConnected) trigger.focus();
              else document.querySelector<HTMLElement>('main h1')?.focus();
            });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {accountName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {accountName}. It can&apos;t be undone.
              If you might want it back someday, archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={pending}>
              Keep it
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction, which would close the
                dialog before the server has answered. */}
            <Button
              variant="destructive"
              // Solid, from tokens AA-tested as a pair (contrast.test.ts):
              // the variant's red-on-tint is 3.99:1 in the light theme.
              className="h-11 bg-destructive text-primary-foreground hover:bg-destructive hover:underline dark:bg-destructive dark:hover:bg-destructive"
              disabled={pending}
              aria-disabled={pending}
              onClick={confirmDelete}
            >
              <Trash2Icon aria-hidden />
              {pending ? 'Deleting…' : `Delete ${accountName}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
