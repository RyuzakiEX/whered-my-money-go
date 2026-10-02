// Asserts that the import-boundary fixtures STILL FAIL lint.
//
// A lint rule nobody has watched fail is a lint rule nobody should trust. A
// typo in a glob, a plugin that stops loading, a config refactor that drops a
// block — each silently disables a boundary, and the first symptom would be
// lib/core quietly importing React months later.
//
// So this inverts the exit code: every fixture MUST produce at least one
// error. If the rules stop working, this script fails.
//
// Same reasoning as M9-B02, which verifies the RLS gate by deliberately
// shipping a table without policies.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_DIR = 'tests/fixtures/lint';

/** Every fixture, and the rule each one must trip. */
const EXPECTED = {
  'lib/core/core-imports-react.ts': 'no-restricted-imports',
  'lib/core/core-reads-clock.ts': 'no-restricted-syntax',
  'components/component-imports-server.tsx': 'no-restricted-imports',
  'components/component-imports-chart.tsx': 'no-restricted-imports',
  'app/app-imports-admin.ts': 'no-restricted-imports',
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const found = walk(FIXTURE_DIR).map((f) => f.split('\\').join('/'));
let failures = 0;

// Every fixture on disk must be declared, so a new one cannot be added and
// then silently ignored.
for (const f of found) {
  const rel = f.replace(`${FIXTURE_DIR}/`, '');
  if (!(rel in EXPECTED)) {
    console.error(`  UNDECLARED  ${rel} — add it to EXPECTED in this script`);
    failures++;
  }
}

for (const [rel, expectedRule] of Object.entries(EXPECTED)) {
  const file = `${FIXTURE_DIR}/${rel}`;
  // Invoke ESLint's own JS entrypoint through node rather than the npx or
  // .cmd shim: on Windows the shim does not reliably surface stdout or an
  // exit status to a spawned parent, and this check depends on both.
  // --no-ignore so the fixtures are linted despite being in `ignores`.
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/eslint/bin/eslint.js',
      '--no-ignore',
      '--format',
      'json',
      file,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const exitCode = result.status ?? 1;
  const output = result.stdout ?? '';

  if (exitCode === 0) {
    console.error(`  NOT ENFORCED  ${rel} — lint PASSED, but it must fail.`);
    failures++;
    continue;
  }

  // ESLint's JSON formatter writes a single array, but npm/npx may prepend
  // banner lines, so slice from the first '[' rather than parsing the whole
  // stream.
  let messages = [];
  try {
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('no JSON array in output');
    messages = JSON.parse(output.slice(start, end + 1)).flatMap(
      (r) => r.messages ?? [],
    );
  } catch (err) {
    console.error(
      `  UNREADABLE  ${rel} — could not parse eslint output (${err.message})`,
    );
    failures++;
    continue;
  }

  const ruleIds = messages.map((m) => m.ruleId).filter(Boolean);
  if (!ruleIds.includes(expectedRule)) {
    console.error(
      `  WRONG RULE  ${rel} — failed, but not on ${expectedRule}. Got: ${ruleIds.join(', ') || '(none)'}`,
    );
    failures++;
    continue;
  }

  console.log(`  enforced    ${rel}  (${expectedRule})`);
}

if (failures > 0) {
  console.error(
    `\n${failures} boundary check(s) not enforced. The import matrix in ` +
      `docs/architecture/source-structure.md is no longer mechanical.`,
  );
  process.exit(1);
}

console.log(
  `\nAll ${Object.keys(EXPECTED).length} import boundaries are enforced.`,
);
