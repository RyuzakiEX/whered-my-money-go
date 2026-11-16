// Skeleton for the accounts list (M2-F01): the same boxes, at the same sizes,
// as the loaded page, so nothing shifts when the data arrives.

import { Skeleton } from '@/components/ui/skeleton';

export default function AccountsLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        Loading your accounts…
      </span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-11 w-36" />
      </div>
      <div className="flex flex-col gap-1 rounded-xl p-6 ring-1 ring-foreground/10">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-5 w-64" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-36" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-5 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-8 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
