// What an account action reports back to the account UI: success, or one
// message ready to show. The page adapts the action's envelope into this
// (app/(app)/accounts/action-result.ts), because components may not import
// lib/server.

export type AccountActionResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /**
       * The request itself failed, so the outcome is unknown: the write may
       * have committed before the response was lost. The caller refreshes
       * rather than assume either way.
       */
      unconfirmed?: true;
    };

/**
 * A thrown request is not a refusal: the server may have done the work. Say
 * so, rather than claim nothing changed.
 */
export const UNCONFIRMED_MESSAGE =
  "We couldn't confirm that with the server. Refresh to see where things stand.";

/** Runs an account action, turning a thrown request into an unconfirmed result. */
export async function settle(
  action: () => Promise<AccountActionResult>,
): Promise<AccountActionResult> {
  try {
    return await action();
  } catch {
    return { ok: false, message: UNCONFIRMED_MESSAGE, unconfirmed: true };
  }
}
