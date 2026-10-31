import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { logger, newRequestId } from '@/lib/server/logger';
import { fail, ok, validationError } from '@/lib/server/result';

/**
 * The logger and the result envelope, without a database. The integration
 * suites exercise them through real actions; these pin the branches that a
 * real action rarely reaches.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('logger', () => {
  it('writes one JSON object per line, with level, time, and event', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('auth.sign_in', {
      requestId: 'r-1',
      userId: 'u-1',
      outcome: 'success',
    });

    expect(out).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(out.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(line).toMatchObject({
      level: 'info',
      event: 'auth.sign_in',
      requestId: 'r-1',
      userId: 'u-1',
      outcome: 'success',
    });
    expect(typeof line['time']).toBe('string');
  });

  it('sends warn and error to stderr, info and debug to stdout', () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    logger.warn('w', { requestId: 'r' });
    logger.error('e', { requestId: 'r' });
    logger.info('i', { requestId: 'r' });
    logger.debug('d', { requestId: 'r' });
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stdout).toHaveBeenCalledTimes(2);
  });

  it('never writes debug lines in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.debug('d', { requestId: 'r' });
    expect(stdout).not.toHaveBeenCalled();
  });

  it('gives every action call its own request id', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

describe('result envelope', () => {
  it('wraps data and errors as plain objects that survive serialisation', () => {
    const success = ok({ a: 1 });
    const failure = fail({ kind: 'unauthenticated' });
    expect(JSON.parse(JSON.stringify(success))).toEqual({
      ok: true,
      data: { a: 1 },
    });
    expect(JSON.parse(JSON.stringify(failure))).toEqual({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
  });

  it('groups Zod issues by field, joining nested paths with dots', () => {
    const schema = z.strictObject({
      email: z.email({ error: 'bad email' }),
      address: z.strictObject({
        city: z.string().min(1, { error: 'need a city' }),
      }),
    });
    const parsed = schema.safeParse({ email: 'x', address: { city: '' } });
    if (parsed.success) throw new Error('expected failure');

    expect(validationError(parsed.error)).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        fields: { email: ['bad email'], 'address.city': ['need a city'] },
      },
    });
  });

  it("files a whole-object issue under '_'", () => {
    const schema = z
      .strictObject({ a: z.string(), b: z.string() })
      .refine((v) => v.a !== v.b, { error: 'must differ' });
    const parsed = schema.safeParse({ a: 'x', b: 'x' });
    if (parsed.success) throw new Error('expected failure');

    const result = validationError(parsed.error);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'validation', fields: { _: ['must differ'] } },
    });
  });

  it('collects several messages for one field', () => {
    const schema = z.strictObject({
      p: z.string().min(8, { error: 'short' }).regex(/\d/, { error: 'digit' }),
    });
    const parsed = schema.safeParse({ p: 'abc' });
    if (parsed.success) throw new Error('expected failure');
    expect(validationError(parsed.error)).toMatchObject({
      error: { fields: { p: ['short', 'digit'] } },
    });
  });
});
