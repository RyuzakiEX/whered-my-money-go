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
    'is',
    'not',
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
      expect(logged()).toContain('unexpected_failure'); // Auth's code, kept
      expect(logged()).not.toContain('JWKS fetch failed');
      expect(updateTag).not.toHaveBeenCalled();
    },
  );

  it("surfaces a failure that is not Auth's instead of reporting an outage", async () => {
    getClaims.mockRejectedValue(new TypeError('a bug'));
    await expect(actions.createAccount(input)).rejects.toThrow('a bug');
  });
});

describe('the documented order: session before input', () => {
  it('answers a signed-out caller unauthenticated, whatever they sent', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    for (const run of [
      ...everyAction.map(([, action]) => action),
      () => actions.updateAccount({ id: 'nope' }),
      () => actions.archiveAccount(null),
      () => actions.deleteAccount({ id: 1 }),
    ]) {
      expect(await run()).toEqual({
        ok: false,
        error: { kind: 'unauthenticated' },
      });
    }
  });

  it('then rejects a missing id as validation', async () => {
    expect(await actions.updateAccount(input)).toMatchObject({
      ok: false,
      error: { kind: 'validation', fields: { id: expect.any(Array) } },
    });
    expect(await actions.updateAccount(null)).toMatchObject({
      error: { kind: 'validation' },
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

  it.each([
    ['updateAccount', () => actions.updateAccount({ ...input, id: ID })],
    ['archiveAccount', () => actions.archiveAccount({ id: ID })],
    ['restoreAccount', () => actions.restoreAccount({ id: ID })],
  ] as const)('%s: the ownership re-check', async (_, run) => {
    results = [dbError];
    expect(await run()).toEqual(UNEXPECTED);
    expect(logged()).toContain('account.read_failed');
  });

  it.each([
    [
      'updateAccount',
      () => actions.updateAccount({ ...input, id: ID }),
      [owned],
    ],
    ['archiveAccount', () => actions.archiveAccount({ id: ID }), [owned]],
    // No pre-read: the user_id-scoped delete is the ownership check.
    ['deleteAccount', () => actions.deleteAccount({ id: ID }), []],
  ] as const)('%s: the write', async (_, run, before) => {
    results = [...before, dbError];
    expect(await run()).toEqual(UNEXPECTED);
    expect(logged()).toContain('account.write_failed');
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe('when the account changes between the re-check and the write', () => {
  const gone = { data: [], error: null };
  const missing = { data: null, error: null };

  it.each([
    [
      'updateAccount',
      () => actions.updateAccount({ ...input, id: ID }),
      [owned, gone],
    ],
    [
      'archiveAccount',
      () => actions.archiveAccount({ id: ID }),
      [owned, gone, missing],
    ],
    ['deleteAccount', () => actions.deleteAccount({ id: ID }), [gone]],
  ] as const)(
    '%s answers not_found when it was deleted',
    async (_, run, script) => {
      results = [...script];
      expect(await run()).toEqual(NOT_FOUND);
      expect(updateTag).not.toHaveBeenCalled();
    },
  );

  it('archiveAccount answers ok, writing nothing, when another request archived it first', async () => {
    results = [
      owned,
      gone,
      {
        data: { currency: 'PHP', archived_at: '2026-11-01T00:00:00Z' },
        error: null,
      },
    ];
    expect(await actions.archiveAccount({ id: ID })).toEqual({
      ok: true,
      data: { id: ID },
    });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
