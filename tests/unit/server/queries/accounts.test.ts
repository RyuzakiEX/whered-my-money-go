import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The account queries' failure paths (M2-B05). The happy paths run against the
 * real database in tests/integration/account-queries.test.ts; these pin what
 * an outage looks like. An Auth or database failure must throw, so the page
 * shows its error boundary — never an empty list that reads as "you have no
 * accounts", which for a money app is a wrong answer, not a crash.
 */

const getClaims = vi.fn();
/** The last query's terminal result, whichever method ends the chain. */
let dbResult: { data: unknown; error: unknown } = { data: [], error: null };

function query(): unknown {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in', 'order']) {
    chain[method] = () => chain;
  }
  chain['maybeSingle'] = () => Promise.resolve(dbResult);
  // Awaiting the builder itself (listAccounts, getAccountBalances).
  chain['then'] = (resolve: (value: unknown) => unknown) => resolve(dbResult);
  return chain;
}

vi.mock('@/lib/server/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getClaims }, from: () => query() }),
}));

const { getAccount, getAccountBalances, listAccounts } =
  await import('@/lib/server/queries/accounts');

const ID = '0b6f3a4e-8f1c-4c2a-9d3e-5a7b8c9d0e1f';
const signedIn = { data: { claims: { sub: 'user-1' } }, error: null };

beforeEach(() => {
  getClaims.mockReset();
  dbResult = { data: [], error: null };
});

describe('when Auth fails', () => {
  beforeEach(() => {
    getClaims.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', message: 'JWKS fetch failed' },
    });
  });

  it.each([
    ['listAccounts', () => listAccounts()],
    ['getAccount', () => getAccount(ID)],
    ['getAccountBalances', () => getAccountBalances([ID])],
  ])('%s throws instead of answering "no accounts"', async (_, run) => {
    await expect(run()).rejects.toThrow(
      'session check failed: unexpected_failure',
    );
  });
});

describe('when the database fails', () => {
  beforeEach(() => {
    getClaims.mockResolvedValue(signedIn);
    dbResult = { data: null, error: { code: '57014' } }; // query_canceled
  });

  it.each([
    ['listAccounts', () => listAccounts(), 'accounts read failed: 57014'],
    ['getAccount', () => getAccount(ID), 'account read failed: 57014'],
    [
      'getAccountBalances',
      () => getAccountBalances([ID]),
      'account balances read failed: 57014',
    ],
  ])('%s throws, naming only the error code', async (_, run, message) => {
    await expect(run()).rejects.toThrow(message);
  });
});

describe('without a session', () => {
  it('reads as nothing, without touching the database', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    dbResult = { data: null, error: { code: 'should-not-be-read' } };
    expect(await listAccounts()).toEqual([]);
    expect(await getAccount(ID)).toBeNull();
    expect(await getAccountBalances([ID])).toEqual(new Map());
  });
});

describe('the session error', () => {
  it("carries Auth's error code for the caller to log", async () => {
    const { SessionError } = await import('@/lib/server/auth/session');
    getClaims.mockResolvedValue({
      data: null,
      error: { code: 'jwks_timeout' },
    });
    const error: unknown = await listAccounts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SessionError);
    expect((error as InstanceType<typeof SessionError>).code).toBe(
      'jwks_timeout',
    );
  });
});
