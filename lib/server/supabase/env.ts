// Shared by the three Supabase client factories. Importable only from
// lib/server/supabase/*.
//
// Takes the VALUE, not the name: Next inlines NEXT_PUBLIC_* into the browser
// bundle only where `process.env.NEXT_PUBLIC_X` is written out literally, so
// the caller must do the read. A dynamic `process.env[name]` here would be
// `undefined` in every client component.

export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set.\n` +
        'Print the local values with `npx supabase status -o env` and copy them ' +
        'into .env.local. See workflow/01-local-setup.md.',
    );
  }
  return value;
}
