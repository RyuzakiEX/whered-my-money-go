// DELIBERATE VIOLATION — must fail lint. Do not "fix" this file.
// Matrix row 8: only components/charts may import the charting library.
//
// Spec §23 leaves the charting library an open choice ("Recharts or another").
// Confined to one directory, swapping it is a contained task; spread across
// feature components, it is a rewrite. It is also the largest client
// dependency, so quarantining it keeps it off routes that render no charts.
// See docs/architecture/frontend-architecture.md#chart-isolation.

import { LineChart } from 'recharts';

export function BrokenSpendingChart() {
  return <LineChart width={400} height={200} />;
}
