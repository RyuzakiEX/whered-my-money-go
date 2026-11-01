// What a missing account renders (M2-F04): one page for an id that never
// existed, a deleted account, and another user's account, so none can be
// told apart.

import Link from 'next/link';

export default function AccountNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3">
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t find that account
      </h1>
      <p className="text-muted-foreground">
        It may have been deleted, or the link is wrong.
      </p>
      <Link
        href="/accounts"
        className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
      >
        Back to your accounts
      </Link>
    </div>
  );
}
