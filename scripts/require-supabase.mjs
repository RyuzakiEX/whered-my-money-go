// Runs a Supabase CLI command, but fails with an actionable message when the
// CLI is missing or the local stack is not running.
//
// M0-B03 requires this: a contributor who has not started Docker should be
// told to start Docker, not handed a stack trace from a tool they have never
// heard of.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!existsSync('supabase/config.toml')) {
  die(
    'Local Supabase is not initialised yet (no supabase/config.toml).\n' +
      '  This lands in M0-B05 — see tasks/backlog/m0-foundation.md.',
  );
}

const probe = spawnSync('supabase', ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (probe.error || probe.status !== 0) {
  die(
    'The Supabase CLI is not installed or not on PATH.\n\n' +
      '    npm install -g supabase\n' +
      '    # or see workflow/01-local-setup.md\n',
  );
}

const result = spawnSync('supabase', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  die(
    `\`supabase ${args.join(' ')}\` failed.\n\n` +
      '  If the local stack is not running:\n\n' +
      '    supabase start      # requires Docker Desktop\n\n' +
      '  See workflow/01-local-setup.md for ports and troubleshooting.',
  );
}
