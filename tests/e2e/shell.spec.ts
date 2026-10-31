import { expect, test } from '@playwright/test';

import { signInAsNewUser } from './session';

/**
 * The app shell's breakpoint — the one M0-F02 behaviour jsdom cannot check,
 * because jsdom has no layout. The drawer's own behaviour (Escape, backdrop,
 * focus trap) is covered in tests/unit/components/shell.test.tsx.
 *
 * App pages need a session since M1-B06, so every test signs a fresh user in.
 */

test.beforeEach(async ({ context, baseURL }) => {
  await signInAsNewUser(context, baseURL ?? 'http://localhost:3000');
});

test.describe('desktop (1280px)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('shows the sidebar and hides the drawer trigger', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open navigation' }),
    ).toBeHidden();
    await expect(
      page.getByRole('link', { name: 'Dashboard', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    // Exactly one visible primary action at this width.
    await expect(
      page.getByRole('button', { name: /add transaction/i }).filter({
        visible: true,
      }),
    ).toHaveCount(1);
  });
});

test.describe('mobile (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('hides the sidebar behind a drawer that navigates', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(
      page.getByRole('button', { name: /add transaction/i }).filter({
        visible: true,
      }),
    ).toHaveCount(1);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('link', { name: 'Goals' }).click();
    await expect(page).toHaveURL(/\/goals$/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Goals');
  });

  test('has no horizontal scroll at 360px', async ({ page }) => {
    await page.goto('/dashboard');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
