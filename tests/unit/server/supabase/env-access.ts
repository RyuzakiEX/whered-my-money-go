/**
 * Replaces process.env with a proxy that records every key read, so a test can
 * assert WHICH variables a factory touched — not just that it worked.
 *
 * "browser.ts reads only public env vars" is otherwise unfalsifiable: the
 * factory would still succeed if it also read the service-role key.
 */
export function recordEnvReads(values: Record<string, string>): {
  reads: Set<string>;
  restore: () => void;
} {
  const original = process.env;
  const reads = new Set<string>();
  // Cast: Next's ProcessEnv typing requires NODE_ENV, which these tests
  // deliberately leave unset.
  process.env = new Proxy({ ...values } as NodeJS.ProcessEnv, {
    get(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key) as unknown;
    },
  });
  return {
    reads,
    restore: () => {
      process.env = original;
    },
  };
}

/**
 * The app's own variables among the recorded reads. Tooling (Vite, Node)
 * reads its own flags while loading modules; those are not the factory's.
 */
export function appReads(reads: Set<string>): string[] {
  return [...reads].filter((k) => /^(NEXT_PUBLIC_|SUPABASE_)/.test(k));
}

export const LOCAL_URL = 'http://127.0.0.1:54321';
// Shape-valid but meaningless JWTs — no request is made in unit tests.
export const FAKE_ANON = 'header.anon-payload.signature';
export const FAKE_SERVICE = 'header.service-payload.signature';
