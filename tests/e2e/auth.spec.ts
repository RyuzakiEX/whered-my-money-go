import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { signInAsNewUser } from './session';

/**
 * M1-B08: the auth happy path, as one story, plus route protection in both
 * directions. This is M1's demo: sign up → land on an empty dashboard → log
 * out → log back in.
 *
 * Rules this file keeps: every run creates its own user (repeatable, and safe
 * in parallel); no fixed sleeps — every wait is on something a user would
 * see; selectors are roles and labels, never CSS classes, so a restyle
 * cannot break it.
 */

const AFTER_SUBMIT = { timeout: 15_000 };

test('sign up, land on the dashboard, log out, and log back in', async ({
  page,
}) => {
  const email = `e2e-loop-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;

  // Sign up.
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel(/what should we call you/i).fill('Loop Tester');
  await page.getByRole('button', { name: 'Create my account' }).click();

  // An empty dashboard, in the shell, with the new user in the account menu.
  await expect(page).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dashboard' }),
  ).toBeVisible();
  const account = page
    .getByRole('button', { name: 'Account menu for Loop Tester' })
    .filter({ visible: true });
  await expect(account).toBeVisible();

  // Log out.
  await account.click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/, AFTER_SUBMIT);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Log in' }),
  ).toBeVisible();

  // Log back in with the same credentials.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dashboard' }),
  ).toBeVisible();
});

test.describe('route protection', () => {
  test('signed out, /dashboard lands on /login?next=%2Fdashboard', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Log in' }),
    ).toBeVisible();
  });

  test('signed in, /login lands on /dashboard', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsNewUser(context, baseURL ?? 'http://localhost:3000');
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible();
  });
});
