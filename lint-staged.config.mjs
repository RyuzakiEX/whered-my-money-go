// pre-commit: format every staged file, lint staged TypeScript only.
//
// Fast by design — the full gate is `npm run verify` and CI. A hook that takes
// long gets bypassed, and a bypassed hook enforces nothing.

/** @type {import('lint-staged').Configuration} */
const config = {
  // TypeScript: format, THEN lint — in sequence. Two globs matching the same
  // file run concurrently, and Prettier rewriting a file while ESLint reads it
  // is a race.
  '*.{ts,tsx}': [
    'prettier --write',
    'eslint --max-warnings=0 --no-warn-ignored',
  ],
  // Everything else: format only. --ignore-unknown skips files Prettier has
  // no parser for, instead of failing the commit.
  '!(*.{ts,tsx})': 'prettier --write --ignore-unknown',
};

export default config;
