// The result envelope every Server Action returns.
//
// MAY BE IMPORTED BY: lib/server/**, and app/ code that calls actions. A plain
// object, so it survives the RSC boundary where an Error subclass does not.
// Spec: docs/architecture/api-and-data-access.md#the-result-envelope.

import type { z } from 'zod';

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ActionError };

export type ActionError =
  | { kind: 'validation'; fields: Record<string, string[]> }
  | { kind: 'unauthenticated' }
  // Sign-in and password-reset failures. One kind and one message for every
  // cause — wrong password, unknown email, unconfirmed account — so the
  // response never reveals whether an account exists (M1-B05).
  | { kind: 'auth_failed'; message: string }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'unexpected'; correlationId: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: ActionError): ActionResult<never> {
  return { ok: false, error };
}

/** Zod issues as `{ field: [messages] }`, the shape a form renders inline. */
export function validationError(error: z.ZodError): ActionResult<never> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fail({ kind: 'validation', fields });
}
