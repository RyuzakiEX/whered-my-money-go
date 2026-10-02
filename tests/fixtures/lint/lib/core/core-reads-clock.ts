// DELIBERATE VIOLATION — must fail lint. Do not "fix" this file.
// Matrix row 1: lib/core must not read the clock or the environment.
//
// `today` is always injected. A function that reads the clock cannot be tested
// on 29 February, at a month boundary, or across a DST transition without
// faking time — and those are exactly the cases the recurrence and
// safe-to-spend algorithms have to get right.
// See docs/adr/0003-pure-typescript-domain-core.md.

export function brokenHorizonEnd(): Date {
  const now = Date.now();
  const today = new Date();
  const horizonDays = Number(process.env['HORIZON_DAYS'] ?? 30);
  return new Date(now + horizonDays * 86_400_000 + today.getTimezoneOffset());
}
