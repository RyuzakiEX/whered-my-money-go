import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { signInAsNewUser } from './session';

/**
 * M1-F04 (account menu, logout) and M1-F05 (Settings > Profile) in a real
 * browser. Every test signs in its own fresh user.
 */

const AFTER_SUBMIT = { timeout: 15_000 };

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

let email = '';
test.beforeEach(async ({ context, baseURL }) => {
  ({ email } = await signInAsNewUser(
    context,
    baseURL ?? 'http://localhost:3000',
  ));
});

/**
 * The trigger is named by the user; with no display name, the email's local
 * part. Located by attribute, not role: while the menu is open, Radix marks
 * the rest of the page aria-hidden, which takes the trigger out of the
 * accessibility tree.
 */
function accountTrigger(page: Page) {
  return page
    .locator('button[aria-label^="Account menu for"]')
    .filter({ visible: true });
}

test.describe('account menu (M1-F04)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('names the user and works from the keyboard', async ({ page }) => {
    await page.goto('/dashboard');
    const trigger = accountTrigger(page);
    await expect(trigger).toHaveAccessibleName(
      `Account menu for ${email.split('@')[0] ?? ''}`,
    );
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    await expect(
      menu.getByRole('menuitem', { name: 'Settings' }),
    ).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
    await expectNoAxeViolations(page);

    // Opening from the keyboard focuses the first item.
    await expect(
      menu.getByRole('menuitem', { name: 'Settings' }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('logs out, and Back does not bring the app back', async ({ page }) => {
    await page.goto('/dashboard');
    await accountTrigger(page).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/, AFTER_SUBMIT);

    await page.goBack();
    await expect(page).toHaveURL(/\/login(\?|$)/, AFTER_SUBMIT);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(
      0,
    );
  });

  test('logs out from the keyboard too', async ({ page }) => {
    await page.goto('/dashboard');
    await accountTrigger(page).focus();
    await page.keyboard.press('Enter'); // opens, focusing Settings
    const menu = page.getByRole('menu');
    // Wait for each focus move: the menu opens asynchronously, and a key
    // pressed before it takes focus lands on the trigger instead.
    await expect(
      menu.getByRole('menuitem', { name: 'Settings' }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login$/, AFTER_SUBMIT);
  });
});

test.describe('account menu in the mobile drawer (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('is inside the drawer and logs out', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    const trigger = drawer.getByRole('button', { name: /^Account menu for/ });
    await expect(trigger).toBeVisible();

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/, AFTER_SUBMIT);
  });
});

test.describe('Settings > Profile (M1-F05)', () => {
  test('is reachable from the account menu and from the sidebar', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await accountTrigger(page).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/, AFTER_SUBMIT);

    await page.goto('/dashboard');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await page.getByRole('link', { name: /Profile/ }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/, AFTER_SUBMIT);
  });

  test('saves name, currency, and timezone, and they survive a reload', async ({
    page,
  }) => {
    await page.goto('/settings/profile');
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();

    await page.getByLabel('Name').fill('Ana');
    await page.getByLabel('Currency').selectOption('USD');
    await expect(page.getByText(/won't convert/)).toBeVisible();
    await page.getByLabel('Timezone').fill('America/New_York');
    await save.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved' }),
    ).toHaveText('Saved. Looking good.', AFTER_SUBMIT);

    await page.reload();
    await expect(page.getByLabel('Name')).toHaveValue('Ana');
    await expect(page.getByLabel('Currency')).toHaveValue('USD');
    await expect(page.getByLabel('Timezone')).toHaveValue('America/New_York');
    // The shell picked up the new name too.
    await expect(accountTrigger(page)).toHaveAccessibleName(
      'Account menu for Ana',
    );
  });

  for (const width of [1280, 360]) {
    test(`is axe-clean with no horizontal scroll at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/settings/profile');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Profile' }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
