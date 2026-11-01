// What an account action reports back to the account UI: success, or one
// message ready to show. The page adapts the action's envelope into this
// (app/(app)/accounts/action-result.ts), because components may not import
// lib/server.

export type AccountActionResult = { ok: true } | { ok: false; message: string };
