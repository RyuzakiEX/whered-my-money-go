import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'What If?' };

// Placeholder. What If? is V2 (spec §18), but it sits in the nav from M0 so
// the information architecture does not shift under users later
// (docs/architecture/frontend-architecture.md#route-groups).
export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold">What If?</h1>
      <p className="mt-2 text-muted-foreground">
        Coming in V2: try a change, like a new bill or a raise, and see what it
        does to your Safe to Spend.
      </p>
    </>
  );
}
