// DELIBERATE VIOLATION — must fail lint. Do not "fix" this file.
// Matrix row 1: lib/core may import only lib/core and the TypeScript stdlib.
//
// Why this matters: lib/core holds every money calculation. Its purity is what
// makes exhaustive unit testing cheap and What-If (spec §18) a re-run with
// different inputs rather than new math. One React import undoes both.

import { useState } from 'react';

export function brokenSafeToSpend(): number {
  const [total] = useState(0);
  return total;
}
