// Conventional Commits, as written in workflow/03-commits.md.
//
// Scopes are READ from tasks/labels.md rather than copied here, so the commit
// scopes and the `area:` labels are one list and cannot drift apart.

import { readFileSync } from 'node:fs';

const labels = readFileSync(
  new URL('./tasks/labels.md', import.meta.url),
  'utf8',
);
const AREAS = [...labels.matchAll(/^\| `area:([a-z0-9-]+)` \|/gm)].map(
  (m) => m[1],
);
if (AREAS.length === 0) {
  // A silent empty list would reject every scoped commit with a baffling error.
  throw new Error('commitlint: no `area:` labels found in tasks/labels.md');
}

/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The types table in workflow/03-commits.md.
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'chore',
        'refactor',
        'test',
        'perf',
        'ci',
        'build',
        'revert',
      ],
    ],
    // Optional, but when present it is an `area:` label — plus `deps` and
    // `deps-dev`, the scopes Dependabot uses for dependency bumps.
    'scope-enum': [2, 'always', [...AREAS, 'deps', 'deps-dev']],
    // "Subject ≤ 72 characters" — the whole header, since that is what
    // `git log --oneline` and GitHub truncate.
    'header-max-length': [2, 'always', 72],
  },
  ignores: [
    // Dependabot writes its own messages: long URL lines in the body, and
    // titles past 72 characters. Machine-written and reviewed as a bump, so
    // its commits are skipped here and its PR titles are skipped in CI.
    (message) => /^Signed-off-by: dependabot\[bot\]/m.test(message),
  ],
};

export default config;
