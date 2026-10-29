// Playwright E2E. Run with `npm run test:e2e`; see workflow/01-local-setup.md.
//
// Locally, `webServer` starts the dev server (or reuses one you have running).
// In CI the job builds first and this starts the production server, so E2E
// exercises what ships rather than the dev compiler.

import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env['CI']);
const PORT = 3000;
const BASE_URL = `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // A stray test.only in CI would silently skip the rest of the suite.
  forbidOnly: CI,
  // Retries only in CI: locally a flaky test should be seen, not absorbed.
  retries: CI ? 2 : 0,
  // One worker in CI for a stable timing profile; locally, Playwright's default.
  ...(CI ? { workers: 1 } : {}),
  reporter: CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Recorded on the first retry: a trace of the failing run without the
    // cost of tracing every passing test.
    trace: 'on-first-retry',
    // Playwright has no "on-first-retry" for screenshots; only-on-failure
    // captures the failing attempt, retries included.
    screenshot: 'only-on-failure',
  },

  // Chromium only — the suite catches broken flows, not rendering differences
  // between engines (docs/ops/testing-strategy.md, "What is not tested").
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: CI ? 'npm run start' : 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
