import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contrast, parseOklch, tokensIn } from '@/tests/unit/design/color';

/**
 * WCAG AA for every token pair the UI actually renders, in BOTH themes —
 * docs/architecture/frontend-architecture.md#accessibility-baseline.
 *
 * A palette tweak that drops a pair below AA fails here, not in a user's eyes.
 *
 *   TEXT  4.5:1  body text, labels, money figures, status text
 *   UI    3:1    boundaries needed to identify a control (input border) and
 *                the focus ring (WCAG 1.4.11 non-text contrast)
 *
 * Decorative separators (`--border` on cards and tables) are exempt under
 * 1.4.11 — they do not identify a control — and are deliberately not listed.
 */

const css = readFileSync('app/globals.css', 'utf8');
const THEMES = {
  light: tokensIn(css, ':root'),
  dark: tokensIn(css, '.dark'),
};

const TEXT = 4.5;
const UI = 3;

/** [foreground token, background token, minimum ratio] */
const PAIRS: [string, string, number][] = [
  ['foreground', 'background', TEXT],
  ['card-foreground', 'card', TEXT],
  ['popover-foreground', 'popover', TEXT],
  ['primary-foreground', 'primary', TEXT],
  ['secondary-foreground', 'secondary', TEXT],
  ['accent-foreground', 'accent', TEXT],
  ['muted-foreground', 'background', TEXT],
  ['muted-foreground', 'muted', TEXT],
  ['muted-foreground', 'card', TEXT],
  ['destructive', 'background', TEXT],
  ['destructive', 'card', TEXT],

  // Money direction and status bands are carried by text, never colour alone
  // — but when colour IS used, it has to be readable.
  ['income', 'background', TEXT],
  ['income', 'card', TEXT],
  ['expense', 'background', TEXT],
  ['expense', 'card', TEXT],
  ['status-green', 'background', TEXT],
  ['status-green', 'card', TEXT],
  ['status-amber', 'background', TEXT],
  ['status-amber', 'card', TEXT],
  ['status-red', 'background', TEXT],
  ['status-red', 'card', TEXT],

  ['input', 'background', UI],
  ['ring', 'background', UI],
];

describe.each(Object.entries(THEMES))('%s theme', (_, tokens) => {
  const value = (name: string) => {
    const v = tokens.get(name);
    if (v === undefined) throw new Error(`--${name} is not defined`);
    return parseOklch(v);
  };

  it.each(PAIRS)('%s on %s ≥ %d:1', (fg, bg, min) => {
    expect(contrast(value(fg), value(bg))).toBeGreaterThanOrEqual(min);
  });
});

describe('colour maths', () => {
  // Known anchors, so a bug in the conversion cannot quietly pass every pair.
  it('black on white is 21:1', () => {
    expect(
      contrast(parseOklch('oklch(0 0 0)'), parseOklch('oklch(1 0 0)')),
    ).toBeCloseTo(21, 1);
  });

  it('white on white is 1:1', () => {
    expect(
      contrast(parseOklch('oklch(1 0 0)'), parseOklch('oklch(1 0 0)')),
    ).toBeCloseTo(1, 5);
  });

  it('a fully transparent colour has the surface contrast of 1:1', () => {
    expect(
      contrast(parseOklch('oklch(0 0 0 / 0%)'), parseOklch('oklch(1 0 0)')),
    ).toBeCloseTo(1, 5);
  });

  it('matches #777 on white ≈ 4.48:1 (just under AA)', () => {
    // #777777 is oklch(0.5693 0 0); its WCAG ratio on white is 4.48.
    expect(
      contrast(parseOklch('oklch(0.5693 0 0)'), parseOklch('oklch(1 0 0)')),
    ).toBeCloseTo(4.48, 1);
  });
});
