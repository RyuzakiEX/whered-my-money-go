// Runs a Supabase CLI command, but fails with an actionable message when the
// CLI is missing or the local stack is not running.
//
// M0-B03 requires this: a contributor who has not started Docker should be
// told to start Docker, not handed a stack trace from a tool they have never
// heard of.
//
// It runs the CLI pinned in devDependencies, never a global install: a global
// `supabase` drifts from the version CI uses, and the generated config, types,
// and migration diffs all differ between CLI versions.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32';
const cli = join(
  'node_modules',
  '.bin',
  isWindows ? 'supabase.cmd' : 'supabase',
);

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!existsSync('supabase/config.toml')) {
  die('No supabase/config.toml found. Run this from the repository root.');
}

const probe = existsSync(cli)
  ? spawnSync(cli, ['--version'], { encoding: 'utf8', shell: isWindows })
  : { error: new Error('missing'), status: 1 };

if (probe.error || probe.status !== 0) {
  die(
    'The pinned Supabase CLI is not installed (node_modules/.bin/supabase).\n\n' +
      '    npm ci\n\n' +
      '  See workflow/01-local-setup.md.',
  );
}

const result = spawnSync(cli, args, { stdio: 'inherit', shell: isWindows });

if (result.status !== 0) {
  die(
    `\`supabase ${args.join(' ')}\` failed.\n\n` +
      '  If the local stack is not running:\n\n' +
      '    npx supabase start      # requires Docker Desktop\n\n' +
      '  See workflow/01-local-setup.md for ports and troubleshooting.',
  );
}
