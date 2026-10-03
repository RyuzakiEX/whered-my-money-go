// Runs the Playwright E2E suite, or explains why it cannot run yet.
//
// M0-B03 requires an actionable message rather than a stack trace. Playwright
// arrives in M0-B09; until then `npm run test:e2e` should say so plainly.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const hasConfig =
  existsSync('playwright.config.ts') || existsSync('playwright.config.js');

if (!hasConfig) {
  console.error(
    '\n  No Playwright config yet — the E2E suite lands in M0-B09.\n' +
      '  See tasks/backlog/m0-foundation.md.\n',
  );
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['playwright', 'test', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

process.exit(result.status ?? 1);
