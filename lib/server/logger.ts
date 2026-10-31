// Structured server logging. One JSON object per line.
//
// MAY BE IMPORTED BY: lib/server/** only.
//
// Redaction is STRUCTURAL: `LoggableContext` is an allowlist, and anything
// not in it cannot be passed — no email, no password, no amount, no raw error
// text (docs/architecture/observability.md#never-log-this). A denylist of key
// names fails the moment someone nests a value; a closed type cannot be
// nested into.

export interface LoggableContext {
  /** Correlates every line of one request or action. */
  requestId: string;
  /** Opaque UUID only — never an email or a name. */
  userId?: string;
  route?: string;
  action?: string;
  durationMs?: number;
  outcome?: 'success' | 'failure';
  /** A stable code, e.g. a Supabase error code — never a driver message. */
  errorCode?: string;
  /** Our own words, never a raw driver string. */
  errorMessage?: string;
  entityId?: string;
  count?: number;
}

type Level = 'error' | 'warn' | 'info' | 'debug';

function write(level: Level, event: string, context: LoggableContext): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    event,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    ...context,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  error: (event: string, context: LoggableContext) => {
    write('error', event, context);
  },
  warn: (event: string, context: LoggableContext) => {
    write('warn', event, context);
  },
  info: (event: string, context: LoggableContext) => {
    write('info', event, context);
  },
  debug: (event: string, context: LoggableContext) => {
    write('debug', event, context);
  },
};

/** A fresh id per action call. Replaced by the request's id once middleware threads one. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
