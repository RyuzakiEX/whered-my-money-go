// Cache tags — constants, never inline strings
// (docs/architecture/state-and-caching.md#cache-tags).
//
// MAY BE IMPORTED BY: lib/server/** (cached reads tag with these; actions
// invalidate through lib/server/cache/revalidate.ts).
//
// Every tag is namespaced by a userId taken from the session, never from
// input: one user's invalidation must not be able to clear — or serve —
// another's data. A typo in a function name is a compile error; a typo in an
// inline `user:${id}:transaction` string is silently stale money.

export const tags = {
  accounts: (userId: string) => `user:${userId}:accounts`,
  transactions: (userId: string) => `user:${userId}:transactions`,
  categories: (userId: string) => `user:${userId}:categories`,
  budgets: (userId: string) => `user:${userId}:budgets`,
  goals: (userId: string) => `user:${userId}:goals`,
  recurring: (userId: string) => `user:${userId}:recurring`,
  dashboard: (userId: string) => `user:${userId}:dashboard`,
  sts: (userId: string) => `user:${userId}:sts`,
  timeline: (userId: string) => `user:${userId}:timeline`,
  profile: (userId: string) => `user:${userId}:profile`,
} as const;

export type TagName = keyof typeof tags;
