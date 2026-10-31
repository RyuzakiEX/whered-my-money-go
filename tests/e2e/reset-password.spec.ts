import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createUser } from './session';

/**
 * M1-F03: password reset, end to end through the real email. Mailpit catches
 * local and CI mail (workflow/01-local-setup.md), so the test follows the
 * exact link a user would click: /auth/confirm with a token hash, which
 * works from any device (code review of #55).
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
      const { HTML } = (await message.json()) as { HTML: string };
      // The template's link: /auth/confirm with a token hash (M1-F03).
      const link = /href="([^"]*\/auth\/confirm[^"]*)"/
        .exec(HTML)?.[1]
        ?.replaceAll('&amp;', '&');
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No reset email reached Mailpit for ${to}`);
}

/**
 * Open an emailed link and press Continue. Opening alone verifies nothing
 * (security review of #55): the token is spent only by the button.
 */
async function openResetLink(page: Page, link: string) {
  await page.goto(link);
  await page
    .getByRole('button', { name: 'Continue to choose a new password' })
    .click();
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

    for (const path of [
      '/reset-password',
      '/reset-password/update',
      '/auth/confirm?token_hash=x&type=recovery&next=/reset-password/update',
    ]) {
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

  await openResetLink(page, await resetLinkFor(user.email));
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

test('works when the email is opened on a different device', async ({
  page,
  browser,
}) => {
  // Requested in one browser, opened in another with no shared cookies: the
  // common laptop-then-phone case, which the old PKCE link always failed
  // (code review of #55).
  const user = await createUser();
  await requestReset(page, user.email);
  const link = await resetLinkFor(user.email);

  const phone = await browser.newContext();
  const other = await phone.newPage();
  await openResetLink(other, link);
  await expect(other).toHaveURL(/\/reset-password\/update$/, AFTER_SUBMIT);
  await other.getByLabel('New password').fill('phone-pass-1');
  await other.getByLabel('Type it again').fill('phone-pass-1');
  await other.getByRole('button', { name: 'Save my new password' }).click();
  await expect(other).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);
  await phone.close();
});

test('a link used twice leads back to a fresh request, not an error', async ({
  browser,
}) => {
  // Each use in a FRESH browser: with a token-hash link a fresh browser can
  // redeem a valid link, so the second one failing proves single use — not a
  // missing cookie (code review of #55).
  const user = await createUser();
  const requester = await browser.newPage();
  await requestReset(requester, user.email);
  const link = await resetLinkFor(user.email);
  await requester.close();

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await openResetLink(firstPage, link);
  await expect(firstPage).toHaveURL(/\/reset-password\/update$/, AFTER_SUBMIT);
  await first.close();

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await openResetLink(secondPage, link);
  await expect(secondPage.getByText(/expired or was already used/)).toBeVisible(
    AFTER_SUBMIT,
  );
  await expect(
    secondPage.getByRole('button', { name: 'Send me a reset link' }),
  ).toBeVisible();
  await second.close();
});

test('opening the link, even twice, does not use it up', async ({
  browser,
}) => {
  // Mail scanners pre-open links; a GET that verified would burn the token
  // before the user clicked (security review of #55).
  const user = await createUser();
  const requester = await browser.newPage();
  await requestReset(requester, user.email);
  const link = await resetLinkFor(user.email);
  await requester.close();

  const scanner = await browser.newContext();
  const scan = await scanner.newPage();
  await scan.goto(link);
  await scan.goto(link);
  await scanner.close();

  const person = await browser.newContext();
  const page = await person.newPage();
  await openResetLink(page, link);
  await expect(page).toHaveURL(/\/reset-password\/update$/, AFTER_SUBMIT);
  await person.close();
});

test('an ordinary signed-in session is not offered the new-password form', async ({
  page,
  context,
  baseURL,
}) => {
  // The form would always fail for it (code review of #55).
  const { signInAsNewUser } = await import('./session');
  await signInAsNewUser(context, baseURL ?? 'http://localhost:3000');
  await page.goto('/reset-password/update');
  await expect(page.getByLabel('New password')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Ask for a fresh reset link' }),
  ).toBeVisible();
});

test('shows a mismatched confirmation on the confirmation field', async ({
  page,
}) => {
  const user = await createUser();
  await requestReset(page, user.email);
  await openResetLink(page, await resetLinkFor(user.email));
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
