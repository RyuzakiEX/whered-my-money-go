import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Log in' };

// Placeholder — the real form is M1-F02. It exists now so the M0-B09 smoke
// test has the route it is specified to visit.
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <p className="text-muted-foreground">
        Signing in arrives with accounts in the next milestone.
      </p>
    </main>
  );
}
