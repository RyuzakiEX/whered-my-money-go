import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

/**
 * The account actions' failure paths (M2-B06). The happy and ownership paths
 * run against the real database in tests/integration/account-actions.test.ts;
 * these script the failures a live stack will not produce on demand. An
 * outage answers `unexpected` with a correlation id — never "signed out",
 * never a driver message — and a row that vanishes mid-action answers
 * `not_found`.
 */

const getClaims = vi.fn();
/** Each query's result, in the order the action runs them. */
let results: { data: unknown; error: unknown }[] = [];

function query(): unknown {
  const next = () =>
    Promise.resolve(results.shift() ?? { data: null, error: null });
  const chain: Record<string, unknown> = {};
  for (const method of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'ilike',
    'limit',
  ]) {
    chain[method] = () => chain;
  }
  chain['single'] = next;
  chain['maybeSingle'] = next;
  chain['then'] = (resolve: (value: unknown) => unknown) =>
    next().then(resolve);
  return chain;
}

vi.mock('@/lib/server/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getClaims }, from: () => query() }),
}));
const updateTag = vi.fn();
vi.mock('next/cache', () => ({ updateTag }));

const actions = await import('@/lib/server/actions/accounts');

const ID = '0b6f3a4e-8f1c-4c2a-9d3e-5a7b8c9d0e1f';
const input = {
  name: 'GCash',
  type: 'ewallet',
  openingBalance: '100',
  excludeFromSafeToSpend: false,
};
const owned = {
  data: { id: ID, currency: 'PHP', archived_at: null },
  error: null,
};
const dbError = {
  data: null,
  error: { code: '57014', message: 'canceling statement' },
};
const UNEXPECTED = {
  ok: false,
  error: { kind: 'unexpected', correlationId: expect.any(String) },
};
const NOT_FOUND = {
  ok: false,
  error: { kind: 'not_found', entity: 'account' },
};

let stderr: MockInstance<typeof console.error>;
beforeEach(() => {
  getClaims.mockReset();
  getClaims.mockResolvedValue({
    data: { claims: { sub: 'user-1' } },
    error: null,
  });
  results = [];
  updateTag.mockClear();
  stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

function logged(): string {
  return stderr.mock.calls.map(([line]) => String(line)).join('\n');
}

const everyAction = [
  ['createAccount', () => actions.createAccount(input)],
  ['updateAccount', () => actions.updateAccount({ ...input, id: ID })],
  ['archiveAccount', () => actions.archiveAccount({ id: ID })],
  ['restoreAccount', () => actions.restoreAccount({ id: ID })],
  ['deleteAccount', () => actions.deleteAccount({ id: ID })],
] as const;

describe('when Auth fails', () => {
  it.each(everyAction)(
    '%s answers unexpected, not unauthenticated',
    async (_, run) => {
      getClaims.mockResolvedValue({
        data: null,
        error: { code: 'unexpected_failure', message: 'JWKS fetch failed' },
      });
      expect(await run()).toEqual(UNEXPECTED);
      expect(logged()).toContain('account.auth_failed');
      expect(logged()).not.toContain('JWKS fetch failed');
      expect(updateTag).not.toHaveBeenCalled();
    },
  );
});

describe('when signed out', () => {
  it.each(everyAction)('%s answers unauthenticated', async (_, run) => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect(await run()).toEqual({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
  });
});

describe('when the database fails', () => {
  it('createAccount: the profile read', async () => {
    results = [dbError];
    expect(await actions.createAccount(input)).toEqual(UNEXPECTED);
    expect(logged()).toContain('account.profile_unreadable');
  });

  it('createAccount: no profile row', async () => {
    results = [{ data: null, error: null }];
    expect(await actions.createAccount(input)).toEqual(UNEXPECTED);
  });

  it('createAccount: the insert', async () => {
    results = [{ data: { currency: 'PHP' }, error: null }, dbError];
    expect(await actions.createAccount(input)).toEqual(UNEXPECTED);
    expect(logged()).toContain('account.write_failed');
    expect(logged()).not.toContain('canceling statement');
  });

  it.each(everyAction.slice(1))(
    '%s: the ownership re-check',
    async (_, run) => {
      results = [dbError];
      expect(await run()).toEqual(UNEXPECTED);
      expect(logged()).toContain('account.read_failed');
    },
  );

  it.each([
    ['updateAccount', () => actions.updateAccount({ ...input, id: ID })],
    ['archiveAccount', () => actions.archiveAccount({ id: ID })],
    ['deleteAccount', () => actions.deleteAccount({ id: ID })],
  ] as const)('%s: the write', async (_, run) => {
    results = [owned, dbError];
    expect(await run()).toEqual(UNEXPECTED);
    expect(logged()).toContain('account.write_failed');
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe('when the account vanishes between the re-check and the write', () => {
  it.each([
    ['updateAccount', () => actions.updateAccount({ ...input, id: ID })],
    ['archiveAccount', () => actions.archiveAccount({ id: ID })],
    ['deleteAccount', () => actions.deleteAccount({ id: ID })],
  ] as const)(
    '%s answers not_found and invalidates nothing',
    async (_, run) => {
      results = [owned, { data: [], error: null }];
      expect(await run()).toEqual(NOT_FOUND);
      expect(updateTag).not.toHaveBeenCalled();
    },
  );
});

describe('updateAccount input', () => {
  it('rejects a missing id before touching Auth or the database', async () => {
    expect(await actions.updateAccount(input)).toMatchObject({
      ok: false,
      error: { kind: 'validation', fields: { id: expect.any(Array) } },
    });
    expect(await actions.updateAccount(null)).toMatchObject({
      error: { kind: 'validation' },
    });
    expect(getClaims).not.toHaveBeenCalled();
  });
});
