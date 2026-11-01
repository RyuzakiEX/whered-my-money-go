import { randomUUID } from 'node:crypto';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { TablesInsert } from '@/types/database';

/**
 * M2-B05: the account queries against the local stack. The user always comes
 * from the session; another user's account reads exactly like a missing one.
 */

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => {
        if (value === '') jar.delete(name);
        else jar.set(name, value);
      },
    }),
}));

const { createAdminClient } = await import('@/lib/server/supabase/admin');
const { createServerSupabaseClient } =
  await import('@/lib/server/supabase/server');
const { getAccount, getAccountBalances, listAccounts } =
  await import('@/lib/server/queries/accounts');

const admin = createAdminClient();
const password = `pw-${randomUUID()}`;
const users: string[] = [];

async function createUser() {
  const email = `m2-b05-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  return { id: data.user.id, email };
}

async function signInAs(email: string) {
  jar.clear();
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function seed(
  userId: string,
  rows: {
    name: string;
    type: TablesInsert<'accounts'>['type'];
    opening_balance_minor?: number;
    archived_at?: string;
  }[],
) {
  const { data, error } = await admin
    .from('accounts')
    .insert(
      // Every row names every column: in a bulk insert PostgREST sends null,
      // not the default, for a column some rows omit.
      rows.map((r) => ({
        user_id: userId,
        currency: 'PHP',
        opening_balance_minor: 0,
        archived_at: null,
        ...r,
      })),
    )
    .select('id, name');
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.name, r.id]));
}

/** Counts PostgREST round trips made while `run` executes. */
async function restCalls(run: () => Promise<unknown>): Promise<number> {
  const real = globalThis.fetch;
  let calls = 0;
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/rest/v1/')) calls++;
      return real(input, init);
    });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

let owner: { id: string; email: string };
let other: { id: string; email: string };
let ids: Record<string, string>;
let otherIds: Record<string, string>;

beforeAll(async () => {
  owner = await createUser();
  other = await createUser();
  ids = await seed(owner.id, [
    { name: 'Wallet', type: 'cash', opening_balance_minor: 50_000 },
    { name: 'BPI', type: 'bank', opening_balance_minor: 1_250_050 },
    { name: 'Maya', type: 'ewallet' },
    { name: 'GCash', type: 'ewallet', opening_balance_minor: 300_000 },
    { name: 'Visa', type: 'credit_card', opening_balance_minor: -1_500_000 },
    {
      name: 'Old bank',
      type: 'bank',
      archived_at: '2026-10-01T00:00:00+00:00',
    },
  ]);
  otherIds = await seed(other.id, [{ name: 'Not yours', type: 'cash' }]);
});

afterEach(() => {
  jar.clear();
});

afterAll(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe('listAccounts', () => {
  it("lists the user's active accounts by type, then name, with balances", async () => {
    await signInAs(owner.email);
    const accounts = await listAccounts();
    expect(accounts.map((a) => [a.type, a.name])).toEqual([
      ['cash', 'Wallet'],
      ['bank', 'BPI'],
      ['ewallet', 'GCash'],
      ['ewallet', 'Maya'],
      ['credit_card', 'Visa'],
    ]);
    // No transactions exist before M3, so a balance is its opening balance.
    expect(accounts.map((a) => a.balanceMinor)).toEqual([
      50_000, 1_250_050, 300_000, 0, -1_500_000,
    ]);
    expect(accounts[0]).toMatchObject({
      id: ids['Wallet'],
      currency: 'PHP',
      openingBalanceMinor: 50_000,
      excludeFromSafeToSpend: false,
      archivedAt: null,
    });
  });

  it('includes archived accounts only when asked', async () => {
    await signInAs(owner.email);
    const all = await listAccounts({ includeArchived: true });
    expect(all.map((a) => a.name)).toEqual([
      'Wallet',
      'BPI',
      'Old bank',
      'GCash',
      'Maya',
      'Visa',
    ]);
    expect(all.find((a) => a.name === 'Old bank')?.archivedAt).not.toBeNull();
  });

  it('returns an empty list for a user with no accounts', async () => {
    const fresh = await createUser();
    await signInAs(fresh.email);
    expect(await listAccounts()).toEqual([]);
  });

  it('never includes another user’s accounts', async () => {
    await signInAs(other.email);
    expect((await listAccounts()).map((a) => a.name)).toEqual(['Not yours']);
  });

  it('returns nothing when signed out', async () => {
    jar.clear();
    expect(await listAccounts()).toEqual([]);
  });

  it('makes one database round trip whether the user has 0, 6, or 20 accounts', async () => {
    const empty = await createUser();
    const many = await createUser();
    await seed(
      many.id,
      Array.from({ length: 20 }, (_, i) => ({
        name: `Account ${String(i)}`,
        type: 'bank',
      })),
    );
    const counts: number[] = [];
    for (const user of [empty, owner, many]) {
      await signInAs(user.email);
      counts.push(
        await restCalls(() => listAccounts({ includeArchived: true })),
      );
    }
    expect(counts).toEqual([1, 1, 1]);
  });
});

describe('getAccount', () => {
  it("returns the user's own account", async () => {
    await signInAs(owner.email);
    const account = await getAccount(ids['GCash'] ?? '');
    expect(account).toMatchObject({
      name: 'GCash',
      type: 'ewallet',
      balanceMinor: 300_000,
    });
  });

  it('returns an archived account too: the detail page shows it with a banner', async () => {
    await signInAs(owner.email);
    expect((await getAccount(ids['Old bank'] ?? ''))?.name).toBe('Old bank');
  });

  it("returns null for another user's account, exactly as for a missing one", async () => {
    await signInAs(owner.email);
    expect(await getAccount(otherIds['Not yours'] ?? '')).toBeNull();
    expect(await getAccount(randomUUID())).toBeNull();
  });

  it('returns null rather than throwing for a malformed id', async () => {
    await signInAs(owner.email);
    expect(await getAccount('not-a-uuid')).toBeNull();
  });

  it('returns null when signed out', async () => {
    jar.clear();
    expect(await getAccount(ids['GCash'] ?? '')).toBeNull();
  });
});

describe('getAccountBalances', () => {
  it('returns the balance of each requested account in one round trip', async () => {
    await signInAs(owner.email);
    let balances = new Map<string, number>();
    const calls = await restCalls(async () => {
      balances = await getAccountBalances([
        ids['Wallet'] ?? '',
        ids['Visa'] ?? '',
      ]);
    });
    expect(calls).toBe(1);
    expect(balances).toEqual(
      new Map([
        [ids['Wallet'], 50_000],
        [ids['Visa'], -1_500_000],
      ]),
    );
  });

  it("leaves out another user's account and malformed ids", async () => {
    await signInAs(owner.email);
    const balances = await getAccountBalances([
      ids['GCash'] ?? '',
      otherIds['Not yours'] ?? '',
      'not-a-uuid',
    ]);
    expect([...balances.keys()]).toEqual([ids['GCash']]);
  });

  it('makes no round trip for an empty request', async () => {
    await signInAs(owner.email);
    expect(await restCalls(() => getAccountBalances([]))).toBe(0);
  });
});
