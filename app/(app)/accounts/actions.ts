'use server';

// The account pages' Server Action adapters (M2-F01..F04), shared by the
// list and the detail page. Each calls the account action — which takes the
// user from the session and re-verifies that the account is theirs before
// writing — and adapts its envelope into what the account UI renders.

import { redirect } from 'next/navigation';

import type { AccountFormValues } from '@/components/accounts/account-form';
import {
  archiveAccount,
  createAccount,
  deleteAccount,
  restoreAccount,
  updateAccount,
} from '@/lib/server/actions/accounts';

import { toAccountActionResult, toAccountFormResult } from './action-result';

/**
 * The form's fields, named one by one. These are endpoints a client can call
 * with anything, so client input is never spread into what the action sees;
 * the action's strict schema then checks each value.
 */
function formFields(values: AccountFormValues | null | undefined) {
  return {
    name: values?.name,
    type: values?.type,
    openingBalance: values?.openingBalance,
    excludeFromSafeToSpend: values?.excludeFromSafeToSpend,
  };
}

/** Create. The currency comes from the profile, inside the action. */
export async function create(values: AccountFormValues) {
  return toAccountFormResult(await createAccount(formFields(values)));
}

/** Edit, with the id bound by the detail page. */
export async function update(id: string, values: AccountFormValues) {
  return toAccountFormResult(
    await updateAccount({ id, ...formFields(values) }),
  );
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

/**
 * Delete from the account's own page, then leave it. Redirecting here, in
 * the same response as the revalidation, means the client never re-renders
 * the deleted account's route into its not-found page first.
 */
export async function removeAndLeave(id: string) {
  const result = toAccountActionResult(await deleteAccount({ id }));
  if (result.ok) redirect('/accounts?deleted=1');
  return result;
}
