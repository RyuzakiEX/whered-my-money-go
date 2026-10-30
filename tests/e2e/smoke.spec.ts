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

test('serves the favicon and the home-screen icon', async ({
  page,
  request,
}) => {
  await page.goto('/');

  // Next emits these from app/icon.svg and app/apple-icon.png. Checking the
  // fetched content type, not just the tag, catches a broken or missing file.
  const icons = [
    { rel: 'icon', type: 'image/svg+xml' },
    { rel: 'apple-touch-icon', type: 'image/png' },
  ];
  for (const { rel, type } of icons) {
    const href = await page
      .locator(`head link[rel="${rel}"]`)
      .first()
      .getAttribute('href');
    expect(href, `<link rel="${rel}">`).toBeTruthy();

    const response = await request.get(href ?? '');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(type);
  }
});
