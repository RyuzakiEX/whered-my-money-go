import { expect, test } from '@playwright/test';

/**
 * Smoke: the app serves real pages. Nothing here asserts merely that a browser
 * launched — each test checks the HTTP status AND something a user would see.
 */

test('the app root returns 200 and renders a page landmark', async ({
  page,
}) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /Where.d My Money Go/,
  );
});

test('/login renders', async ({ page }) => {
  const response = await page.goto('/login');

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Log in' }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Log in/);
});
