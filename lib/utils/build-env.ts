// Build-time check that the public Supabase variables are present.
//
// Used by next.config.ts. NEXT_PUBLIC_* values are inlined at build time, and
// proxy.ts needs these on every request — so a build without them deploys
// "successfully" and then answers 500 on every page. That happened to
// production on 2026-10-31; failing the build keeps the last good deployment
// live instead.

export const REQUIRED_PUBLIC_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

/** The required variables that are missing or blank in `env`. */
export function missingPublicEnv(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return REQUIRED_PUBLIC_ENV.filter((name) => !env[name]?.trim());
}
