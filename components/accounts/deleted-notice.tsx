'use client';

// Confirms a delete made on an account's own page (M2-F04). That delete
// redirects here from the server — so the deleted account's route is never
// re-rendered into its not-found page — and a redirect leaves the client no
// promise to toast from. The list says it instead, then drops the flag from
// the URL so a reload does not say it again.

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

export function DeletedNotice() {
  const router = useRouter();
  useEffect(() => {
    // A fixed id: React's development double effect must not toast twice.
    toast.success('Account deleted. Clean slate.', { id: 'account-deleted' });
    router.replace('/accounts', { scroll: false });
  }, [router]);
  return null;
}
