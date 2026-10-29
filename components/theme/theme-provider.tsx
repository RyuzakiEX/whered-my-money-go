'use client';

// Client boundary justification: browser API (localStorage, matchMedia).
//
// next-themes puts `class="dark"` on <html> (Tailwind's `dark` variant in
// app/globals.css keys off it), persists the choice in localStorage, and on a
// first visit — nothing stored yet — follows `prefers-color-scheme`. Its inline
// script sets the class before paint, so there is no light flash in dark mode.

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
