'use client';

// Restore on an archived account's card (M2-F01). Client-side only for the
// pending state and the toast that announces the outcome; the page passes in
// its adapter around restoreAccount, because components may not import
// lib/server.

import { ArchiveRestoreIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { settle, type AccountActionResult } from './action-result';

export function RestoreAccountButton({
  accountName,
  restoreAction,
  focusAfter,
}: {
  accountName: string;
  restoreAction: () => Promise<AccountActionResult>;
  /**
   * Where focus goes after a restore, which always takes this button away.
   * Falls back to the page heading when that element is not there (yet).
   */
  focusAfter?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function restore() {
    startTransition(async () => {
      const result = await settle(restoreAction);
      if (result.ok) {
        toast.success(`${accountName} is back. Welcome home.`);
        // A restore always takes this button away — the card moves to the
        // active list, the detail page's banner goes — so focus moves on
        // rather than fall to <body>.
        requestAnimationFrame(() => {
          const target =
            (focusAfter ? document.getElementById(focusAfter) : null) ??
            document.querySelector<HTMLElement>('main h1');
          target?.focus();
        });
      } else {
        toast.error(result.message);
      }
      if (!result.ok && result.unconfirmed) router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      disabled={pending}
      aria-disabled={pending}
      onClick={restore}
      aria-label={`Restore ${accountName}`}
    >
      <ArchiveRestoreIcon aria-hidden />
      {pending ? 'Restoring…' : 'Restore'}
    </Button>
  );
}
