// The app's primary action, reachable from every page
// (docs/architecture/frontend-architecture.md#route-groups). Server Component.

import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

export function AddTransactionButton({ className }: { className?: string }) {
  return (
    // TODO(M3-F01): open the add-transaction form. Non-functional in M0.
    //
    // aria-disabled rather than disabled: a disabled button leaves the tab
    // order, so a keyboard user would never find the app's main action.
    <Button
      size="lg"
      aria-disabled="true"
      title="Adding transactions arrives with M3"
      className={cn('min-h-11 w-full', className)}
    >
      <PlusIcon aria-hidden />
      Add Transaction
    </Button>
  );
}
