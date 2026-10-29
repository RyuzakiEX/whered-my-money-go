import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reports' };

// Placeholder — becomes real in V2 (spec §16; tasks/backlog/v2-outline.md).
export default function Page() {
  return <h1 className="text-2xl font-semibold">Reports</h1>;
}
