// Adapts a Server Action's result envelope into what an auth form renders.
//
// Lives in app/ because components/ may not import lib/server: the page is
// the one layer allowed to know both sides.

import type { FormState } from '@/components/auth/form-parts';
import type { ActionResult } from '@/lib/server/result';

export function toFormState(result: ActionResult<unknown>): FormState {
  if (result.ok) return { done: true };
  const { error } = result;
  switch (error.kind) {
    case 'validation':
      return { fields: error.fields };
    case 'auth_failed':
      return { message: error.message };
    case 'rate_limited':
      return {
        message: `Whoa, that's a lot of tries. Take a breather and try again in about ${String(Math.ceil(error.retryAfterSeconds / 60))} minutes.`,
      };
    case 'unauthenticated':
      return { message: 'Your session ended. Log in and try again.' };
    case 'unexpected':
      return {
        message: `Something went wrong on our side. Try again, and if it keeps happening, mention code ${error.correlationId}.`,
      };
  }
}
