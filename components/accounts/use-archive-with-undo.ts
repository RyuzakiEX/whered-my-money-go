'use client';

// Archive with an Undo toast — shared by the list (M2-F03) and the detail
// page (M2-F04), so the copy, the Undo wiring, and the rule for a request
// that failed outright live in one place.

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { settle, type AccountActionResult } from './action-result';

type Action = () => Promise<AccountActionResult>;

export function useArchiveWithUndo() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function report(result: AccountActionResult, success: () => void) {
    if (result.ok) {
      success();
      return;
    }
    toast.error(result.message);
    // The write may have committed before the response was lost.
    if (result.unconfirmed) router.refresh();
  }

  /**
   * Archives, then offers Undo. `beforeWrite` runs inside the transition
   * first — the list hides the card there, optimistically.
   */
  function archive(
    name: string,
    archiveAction: Action,
    restoreAction: Action,
    beforeWrite?: () => void,
  ) {
    startTransition(async () => {
      beforeWrite?.();
      report(await settle(archiveAction), () =>
        toast.success(`${name} archived. It's resting, not gone.`, {
          action: {
            label: 'Undo',
            onClick: () => {
              startTransition(async () => {
                report(await settle(restoreAction), () =>
                  toast.success(`${name} is back.`),
                );
              });
            },
          },
        }),
      );
    });
  }

  return { archive, pending };
}
