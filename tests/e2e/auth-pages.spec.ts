import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createUser } from './session';

/**
 * M1-F01 (sign-up) and M1-F02 (log in), in a real browser against the local
 * stack: accessibility, keyboard use, 360px, inline validation, the uniform
 * login failure, `next`, and the no-JavaScript fallback.
 */

const PAGES = ['/signup', '/login'] as const;

/**
 * A submission is a Server Action, a redirect, and a render; under `next dev`
 * the first render of the target route also compiles it. Give URL changes
 * after a submit more than the 5s default.
 */
const AFTER_SUBMIT = { timeout: 15_000 };

const SIGN_IN_FAILED =
  "That email and password don't match an account. Check both and try again.";

/** The form's message. Next's route announcer is also role="alert", so match by text. */
function formAlert(page: Page) {
  return page.getByRole('alert').filter({ hasText: SIGN_IN_FAILED });
}

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  // The ids alone make a failure readable in the CI log.
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

for (const width of [1280, 360]) {
  test.describe(`${String(width)}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of PAGES) {
      test(`${path} is axe-clean and has no horizontal scroll`, async ({
        page,
      }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe('sign-up (M1-F01)', () => {
  test('creates an account and lands on the dashboard', async ({ page }) => {
    await page.goto('/signup');
    await page
      .getByLabel('Email')
      .fill(`e2e-signup-${String(Date.now())}@example.test`);
    await page.getByLabel('Password').fill('hunter22');
    await page.getByLabel(/what should we call you/i).fill('Ana');
    await page.getByRole('button', { name: 'Create my account' }).click();

    await expect(page).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Dashboard',
    );
  });

  test('shows an inline error on blur, tied to the field', async ({ page }) => {
    await page.goto('/signup');
    const email = page.getByLabel('Email');
    await email.fill('not-an-email');
    await email.blur();

    const error = page.locator('#email-error');
    await expect(error).toHaveText(/doesn't look like an email/);
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAttribute('aria-describedby', /email-error/);
    await expectNoAxeViolations(page); // the error state is accessible too
  });

  test('does not submit an invalid form, and focuses the first problem', async ({
    page,
  }) => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill('ana@example.test');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create my account' }).click();

    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel('Password')).toBeFocused();
    await expect(page.locator('#password-error')).toHaveText(
      /at least 8 characters/,
    );
  });
});

test.describe('log in (M1-F02)', () => {
  test('answers a wrong password with the uniform message, focused', async ({
    page,
  }) => {
    const user = await createUser();
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('not-the-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();

    const alert = formAlert(page);
    await expect(alert).toHaveText(SIGN_IN_FAILED);
    await expect(alert).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('says exactly the same for an email with no account', async ({
    page,
  }) => {
    await page.goto('/login');
    await page
      .getByLabel('Email')
      .fill(`nobody-${String(Date.now())}@example.test`);
    await page.getByLabel('Password').fill('whatever-123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(formAlert(page)).toHaveText(SIGN_IN_FAILED);
  });

  test('returns to where the visitor was going', async ({ page }) => {
    const user = await createUser();
    await page.goto('/goals'); // signed out: the proxy sends us to /login?next=/goals
    await expect(page).toHaveURL(/\/login\?next=%2Fgoals$/);

    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/goals$/, AFTER_SUBMIT);
  });

  test('can be completed with the keyboard alone', async ({ page }) => {
    const user = await createUser();
    await page.goto('/login');
    await page.getByLabel('Email').focus();
    await page.keyboard.type(user.email);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password')).toBeFocused();
    await page.keyboard.type(user.password);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('log-in still submits and shows the server message', async ({
    page,
  }) => {
    await page.goto('/login');
    await page
      .getByLabel('Email')
      .fill(`nobody-${String(Date.now())}@example.test`);
    await page.getByLabel('Password').fill('whatever-123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(
      page.getByText("That email and password don't match an account."),
    ).toBeVisible();
  });

  test('sign-up still works end to end', async ({ page }) => {
    await page.goto('/signup');
    await page
      .getByLabel('Email')
      .fill(`e2e-nojs-${String(Date.now())}@example.test`);
    await page.getByLabel('Password').fill('hunter22');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, AFTER_SUBMIT);
  });
});
