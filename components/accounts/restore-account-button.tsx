'use client';

// Restore on an archived account's card (M2-F01). Client-side only for the
// pending state and the toast that announces the outcome; the page passes in
// its adapter around restoreAccount, because components may not import
// lib/server.

import { ArchiveRestoreIcon } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import type { AccountActionResult } from './action-result';

export function RestoreAccountButton({
  accountName,
  restoreAction,
}: {
  accountName: string;
  restoreAction: () => Promise<AccountActionResult>;
}) {
  const [pending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      let result: AccountActionResult;
      try {
        result = await restoreAction();
      } catch {
        // The request itself failed (offline, a deploy mid-click): no
        // envelope came back, but the user still needs to hear about it.
        result = {
          ok: false,
          message:
            "We couldn't reach the server. Check your connection and try again.",
        };
      }
      if (result.ok) toast.success(`${accountName} is back. Welcome home.`);
      else toast.error(result.message);
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
