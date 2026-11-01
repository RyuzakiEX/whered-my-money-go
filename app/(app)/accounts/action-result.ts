// Adapts an account action's result envelope into what the account UI shows.
//
// Lives in app/ because components/ may not import lib/server: the page is
// the one layer allowed to know both sides (as app/(auth)/form-state.ts).

import type { AccountSaveResult } from '@/components/accounts/account-form';
import type { AccountActionResult } from '@/components/accounts/action-result';
import type { ActionResult } from '@/lib/server/result';

export function toAccountActionResult(
  result: ActionResult<unknown>,
): AccountActionResult {
  if (result.ok) return { ok: true };
  const { error } = result;
  switch (error.kind) {
    case 'not_found':
      return {
        ok: false,
        message:
          "We couldn't find that account. It may have been deleted in another tab. Refresh to see the latest.",
      };
    case 'conflict':
      return { ok: false, message: error.message };
    case 'unauthenticated':
      return {
        ok: false,
        message: 'Your session ended. Log in and try again.',
      };
    case 'unexpected':
      return {
        ok: false,
        message: `Something went wrong on our side. Try again, and if it keeps happening, mention code ${error.correlationId}.`,
      };
    // Archive, restore, and delete take only an id the page supplied; these
    // are listed so the switch stays exhaustive.
    case 'validation':
    case 'auth_failed':
    case 'rate_limited':
      return { ok: false, message: "That didn't work. Refresh and try again." };
  }
}

/**
 * The account form's view of a create or update: field errors stay keyed by
 * field (a taken name lands on the name input), anything else is one message.
 */
export function toAccountFormResult(
  result: ActionResult<unknown>,
): AccountSaveResult {
  if (!result.ok && result.error.kind === 'validation') {
    return { ok: false, fields: result.error.fields };
  }
  return toAccountActionResult(result);
}
