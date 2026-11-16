import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * M2-B07: account CRUD as one story — M2's demo, and the proof of spec §31
 * Q1, "How much money do I have?" (docs/product/success-criteria.md #1).
 *
 * Rules this file keeps, as auth.spec.ts does: every run signs up its own
 * user (repeatable, and safe in parallel); no fixed sleeps — every wait is on
 * something a user would see; selectors are roles and labels, never CSS
 * classes. Amounts are typed as decimal text, the way a user would.
 */

const AFTER_SUBMIT = { timeout: 15_000 };

/** The card for an account, found by its one link: the account's name. */
function card(page: Page, name: string) {
  return page
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
}

/** The figure itself, matched exactly: a substring would pass `-₱…`. */
function total(page: Page) {
  return page
    .getByRole('region', { name: 'Spendable total' })
    .getByTestId('spendable-total');
}

/**
 * A card's balance line, matched as a whole string — "Balance: ₱1,500.50" —
 * so `-₱1,500.50` or `₱11,500.50` cannot pass for it.
 */
function balanceOn(page: Page, name: string, amount: string) {
  return card(page, name).getByText(`Balance: ${amount}`, { exact: true });
}

async function addAccount(
  page: Page,
  values: { name: string; type: string; openingBalance: string },
) {
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add account' })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add an account' });
  await dialog.getByLabel('Name').fill(values.name);
  await dialog.getByLabel('Type').selectOption({ label: values.type });
  await dialog.getByLabel('Opening balance').fill(values.openingBalance);
  await dialog.getByRole('button', { name: 'Add account' }).click();
  return dialog;
}

async function openActions(page: Page, name: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
}

test('create, view, edit, archive, restore, and delete accounts', async ({
  page,
}) => {
  await test.step('sign up and reach Accounts in one click', async () => {
    await page.goto('/signup');
    await page
      .getByLabel('Email')
      .fill(`e2e-accounts-${randomUUID()}@example.test`);
    await page.getByLabel('Password').fill(`Pw-${randomUUID()}`);
    await page.getByLabel(/what should we call you/i).fill('Ana');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);

    await page
      .getByRole('navigation', { name: 'Main' })
      .filter({ visible: true })
      .getByRole('link', { name: 'Accounts' })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Accounts' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /No accounts yet/ }),
    ).toBeVisible();
  });

  await test.step('create Cash, Bank, and a GCash e-wallet', async () => {
    for (const account of [
      { name: 'Cash', type: 'Cash', openingBalance: '1500.50' },
      { name: 'BPI', type: 'Bank', openingBalance: '20,000' },
      {
        name: 'GCash',
        type: 'E-wallet (GCash, Maya)',
        openingBalance: '750.25',
      },
    ]) {
      const dialog = await addAccount(page, account);
      await expect(dialog).toBeHidden(AFTER_SUBMIT);
      await expect(card(page, account.name)).toBeVisible(AFTER_SUBMIT);
    }
  });

  await test.step('each card shows its balance; the total is their sum (Q1)', async () => {
    await expect(balanceOn(page, 'Cash', '₱1,500.50')).toBeVisible();
    await expect(balanceOn(page, 'BPI', '₱20,000.00')).toBeVisible();
    await expect(balanceOn(page, 'GCash', '₱750.25')).toBeVisible();
    await expect(card(page, 'GCash')).toContainText('E-wallet');
    // 150050 + 2000000 + 75025 = 2225075 minor units.
    await expect(total(page)).toHaveText('₱22,250.75');
  });

  await test.step('edit a name and balance; list and detail both update', async () => {
    await page.getByRole('link', { name: 'BPI', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'BPI' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit BPI', exact: true });
    await expect(dialog.getByLabel('Opening balance')).toHaveValue('20000.00');
    await dialog.getByLabel('Name').fill('BPI Savings');
    await dialog.getByLabel('Opening balance').fill('25,000.10');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden(AFTER_SUBMIT);

    await expect(
      page.getByRole('heading', { level: 1, name: 'BPI Savings' }),
    ).toBeVisible();
    // The derived current balance, not the region: that also holds the
    // opening-balance row, which would pass on its own.
    await expect(page.getByTestId('current-balance')).toHaveText('₱25,000.10');
    await expect(page.getByTestId('opening-balance')).toHaveText('₱25,000.10');

    await page.getByRole('link', { name: 'All accounts' }).click();
    await expect(balanceOn(page, 'BPI Savings', '₱25,000.10')).toBeVisible();
    await expect(card(page, 'BPI')).toHaveCount(0);
    // 150050 + 2500010 + 75025 = 2725085.
    await expect(total(page)).toHaveText('₱27,250.85');
  });

  await test.step('a name differing only in case is refused inline', async () => {
    const dialog = await addAccount(page, {
      name: 'gcash',
      type: 'Cash',
      openingBalance: '1',
    });
    await expect(
      dialog.getByText(
        'You already have an account called "GCash". Pick a different name.',
      ),
    ).toBeVisible(AFTER_SUBMIT);
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(card(page, 'gcash')).toHaveCount(0);
  });

  await test.step('archive leaves the list and the total; restore brings it back', async () => {
    await openActions(page, 'Cash');
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(card(page, 'Cash')).toHaveCount(0);
    // The hide is optimistic; the toast and the total are the server's word.
    await expect(
      page.getByText("Cash archived. It's resting, not gone."),
    ).toBeVisible(AFTER_SUBMIT);
    // 2725085 - 150050 = 2575035.
    await expect(total(page)).toHaveText('₱25,750.35', AFTER_SUBMIT);

    await page.getByRole('link', { name: 'Show archived accounts' }).click();
    await expect(page).toHaveURL(/\?archived=1$/);
    await expect(
      page.getByRole('region', { name: /^Archived/ }).getByRole('link', {
        name: 'Cash',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Restore Cash' }).click();
    await expect(total(page)).toHaveText('₱27,250.85', AFTER_SUBMIT);
    await expect(
      page.getByRole('region', { name: 'Your accounts' }).getByRole('link', {
        name: 'Cash',
        exact: true,
      }),
    ).toBeVisible();
  });

  await test.step('delete a transaction-free account; gone after a reload', async () => {
    await openActions(page, 'GCash');
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete GCash?' });
    await expect(
      confirm.getByRole('button', { name: 'Keep it' }),
    ).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete account' }).click();
    await expect(confirm).toBeHidden(AFTER_SUBMIT);

    await page.reload();
    await expect(card(page, 'Cash')).toBeVisible();
    await expect(card(page, 'GCash')).toHaveCount(0);
    // 2725085 - 75025 = 2650060.
    await expect(total(page)).toHaveText('₱26,500.60');
  });
});
