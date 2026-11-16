// Skeleton for an account's page (M2-F04). Without it, the accounts list's
// loading.tsx would wrap this route too and flash the list's skeleton.

import { Skeleton } from '@/components/ui/skeleton';

export default function AccountLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        Loading the account…
      </span>
      <Skeleton className="h-11 w-32" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-lg" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      <div className="flex flex-col gap-4 rounded-xl p-6 ring-1 ring-foreground/10">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-36 w-full rounded-xl" />
    </div>
  );
}
