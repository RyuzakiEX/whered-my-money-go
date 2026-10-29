import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The app shell is a Server Component; `'use client'` is allowed only where a
 * component genuinely needs the browser
 * (docs/architecture/frontend-architecture.md#the-serverclient-boundary).
 *
 * Listing the boundaries here means adding one is a visible, reviewed change
 * to this test — not something that slips into the shell unnoticed.
 */

const SHELL_DIRS = ['app/(app)', 'components/shell', 'components/theme'];

const ALLOWED = new Set([
  'components/shell/mobile-nav.tsx', // drawer open/close state
  'components/shell/nav-link.tsx', // usePathname() for aria-current
  'components/theme/theme-provider.tsx', // localStorage, matchMedia
  'components/theme/theme-toggle.tsx', // interaction
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full.split('\\').join('/')] : [];
  });
}

function isClient(file: string): boolean {
  // The directive must be the first statement; comments may precede it.
  const code = readFileSync(file, 'utf8')
    .replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/g, '')
    .trimStart();
  return /^['"]use client['"]/.test(code);
}

describe('client boundaries in the app shell', () => {
  const files = SHELL_DIRS.flatMap(walk);
  const clients = files.filter(isClient);

  it('scans the shell (guards against a wrong path silently passing)', () => {
    expect(files).toContain('app/(app)/layout.tsx');
    expect(files.length).toBeGreaterThan(10);
  });

  it("declares 'use client' only in the allowed files", () => {
    expect(new Set(clients)).toEqual(ALLOWED);
  });

  it('keeps the shell layout a Server Component', () => {
    expect(isClient('app/(app)/layout.tsx')).toBe(false);
  });
});
