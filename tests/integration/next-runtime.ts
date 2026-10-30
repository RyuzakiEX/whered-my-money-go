/**
 * Import FIRST in any test that loads Next.js server modules (`next/server`,
 * proxy.ts). A running Next server installs a global AsyncLocalStorage before
 * its own modules load; without it, Next captures a placeholder that throws
 * "AsyncLocalStorage accessed in runtime where it is not available" the first
 * time a request-scoped API is touched. ES modules evaluate in import order,
 * so this side effect must come before every Next import.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
  AsyncLocalStorage;
