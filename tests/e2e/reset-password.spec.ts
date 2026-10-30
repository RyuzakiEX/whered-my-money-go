import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createUser } from './session';

/**
 * M1-F03: password reset, end to end through the real email. Mailpit catches
 * local and CI mail (workflow/01-local-setup.md), so the test follows the
 * exact link a user would click — including Auth's verify redirect and the
 * /auth/callback code exchange.
 */

const MAILPIT = 'http://127.0.0.1:54324';
const RESET_REQUESTED =
  "If there's an account for that email, a reset link is on its way. Check your inbox (and the spam folder, just in case).";
const AFTER_SUBMIT = { timeout: 15_000 };

/** The reset link from the newest email to `to`, waiting for it to arrive. */
async function resetLinkFor(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as {
      messages: { ID: string }[];
    };
    const id = messages[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${id}`);
      const { Text } = (await message.json()) as { Text: string };
      const link = /https?:\/\/\S+\/auth\/v1\/verify\?\S+/.exec(Text)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No reset email reached Mailpit for ${to}`);
}

async function requestReset(page: Page, email: string) {
  await page.goto('/reset-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send me a reset link' }).click();
  await expect(page.getByRole('status')).toHaveText(
    RESET_REQUESTED,
    AFTER_SUBMIT,
  );
}

for (const width of [1280, 360]) {
  test.describe(`${String(width)}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of ['/reset-password', '/reset-password/update']) {
      test(`${path} is axe-clean with no horizontal scroll`, async ({
        page,
      }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test('answers identically whether or not the email has an account', async ({
  page,
}) => {
  const user = await createUser();
  await requestReset(page, user.email);
  const known = await page.getByRole('status').innerText();

  await requestReset(page, `nobody-${String(Date.now())}@example.test`);
  const unknown = await page.getByRole('status').innerText();

  expect(unknown).toBe(known);
});

test('resets the password through the emailed link, then logs in with it', async ({
  page,
  browser,
}) => {
  const user = await createUser();
  await requestReset(page, user.email);

  await page.goto(await resetLinkFor(user.email));
  await expect(page).toHaveURL(/\/reset-password\/update$/, AFTER_SUBMIT);

  await page.getByLabel('New password').fill('brand-new-pass-1');
  await page.getByLabel('Type it again').fill('brand-new-pass-1');
  await page.getByRole('button', { name: 'Save my new password' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);

  // A fresh browser: the NEW password works.
  const fresh = await browser.newPage();
  await fresh.goto('/login');
  await fresh.getByLabel('Email').fill(user.email);
  await fresh.getByLabel('Password').fill('brand-new-pass-1');
  await fresh.getByRole('button', { name: 'Log in' }).click();
  await expect(fresh).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);
  await fresh.close();
});

test('a link used twice leads back to a fresh request, not an error', async ({
  page,
  browser,
}) => {
  const user = await createUser();
  await requestReset(page, user.email);
  const link = await resetLinkFor(user.email);

  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\/update$/, AFTER_SUBMIT);

  const second = await browser.newPage();
  await second.goto(link);
  await expect(second.getByText(/expired or was already used/)).toBeVisible(
    AFTER_SUBMIT,
  );
  await expect(
    second.getByRole('button', { name: 'Send me a reset link' }),
  ).toBeVisible();
  await second.close();
});

test('shows a mismatched confirmation on the confirmation field', async ({
  page,
}) => {
  const user = await createUser();
  await requestReset(page, user.email);
  await page.goto(await resetLinkFor(user.email));
  await expect(page).toHaveURL(/\/reset-password\/update$/, AFTER_SUBMIT);

  await page.getByLabel('New password').fill('brand-new-pass-1');
  const confirm = page.getByLabel('Type it again');
  await confirm.fill('brand-new-pass-2');
  await page.getByRole('button', { name: 'Save my new password' }).click();

  await expect(page.locator('#confirmPassword-error')).toHaveText(
    /don't match/,
  );
  await expect(confirm).toHaveAttribute('aria-invalid', 'true');
});
