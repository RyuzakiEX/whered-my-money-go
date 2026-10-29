import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme/theme-provider';
import { cn } from '@/components/ui/cn';
import { Toaster } from '@/components/ui/sonner';

import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: {
    default: "Where'd My Money Go",
    template: "%s · Where'd My Money Go",
  },
  description:
    'A simple budgeting app that answers one question: where did my money go?',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Both themes are first-class from the start — retrofitting a token system
  // later means auditing every component.
  // See docs/architecture/frontend-architecture.md.
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // before React hydrates, so the server and client class lists differ by
    // design. It applies to this element only, not its children.
    <html
      lang="en"
      className={cn('font-sans', geist.variable)}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
