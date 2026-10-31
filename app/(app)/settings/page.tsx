import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <nav aria-label="Settings">
        <ul className="flex flex-col gap-2">
          <li>
            <Link
              href="/settings/profile"
              className="flex min-h-11 flex-col justify-center rounded-lg border p-4 hover:bg-accent"
            >
              <span className="font-medium">Profile</span>
              <span className="text-sm text-muted-foreground">
                Your name, currency, and timezone.
              </span>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
