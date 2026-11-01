'use server';

// The account pages' Server Action adapters (M2-F01..F04), shared by the
// list and the detail page. Each calls the account action — which takes the
// user from the session and re-verifies that the account is theirs before
// writing — and adapts its envelope into what the account UI renders.

import type { AccountFormValues } from '@/components/accounts/account-form';
import {
  archiveAccount,
  createAccount,
  deleteAccount,
  restoreAccount,
  updateAccount,
} from '@/lib/server/actions/accounts';

import { toAccountActionResult, toAccountFormResult } from './action-result';

/** Create. The currency comes from the profile, inside the action. */
export async function create(values: AccountFormValues) {
  return toAccountFormResult(await createAccount(values));
}

/**
 * Edit, with the id bound by the detail page. The id goes last so the bound
 * one wins; the action's strict schema rejects any key the form lacks.
 */
export async function update(id: string, values: AccountFormValues) {
  return toAccountFormResult(await updateAccount({ ...values, id }));
}

export async function archive(id: string) {
  return toAccountActionResult(await archiveAccount({ id }));
}

export async function restore(id: string) {
  return toAccountActionResult(await restoreAccount({ id }));
}

export async function remove(id: string) {
  return toAccountActionResult(await deleteAccount({ id }));
}
