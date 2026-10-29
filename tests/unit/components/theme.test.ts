import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '@/components/theme/theme-provider';
import { ThemeToggle } from '@/components/theme/theme-toggle';

/**
 * Server render only — the unit project has no DOM. That is enough to pin
 * what a screen-reader user meets before any JavaScript runs: a real button
 * with an accessible name that opens a menu.
 */
describe('ThemeToggle', () => {
  const html = renderToString(
    createElement(ThemeProvider, null, createElement(ThemeToggle)),
  );

  it('renders a button that announces a menu', () => {
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"/);
  });

  it('has an accessible name, not just an icon', () => {
    expect(html).toMatch(/<span class="sr-only">Theme<\/span>/);
  });

  it('hides the decorative icons from assistive technology', () => {
    const icons = html.match(/<svg[^>]*>/g) ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon).toContain('aria-hidden="true"');
  });

  it('meets the 44px touch-target minimum', () => {
    expect(html).toMatch(/<button[^>]*class="[^"]*\bsize-11\b/);
  });
});
