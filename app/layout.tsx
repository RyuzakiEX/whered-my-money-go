import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
