import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The account pages' adapters (app/(app)/accounts/actions.ts) are endpoints
 * a client can call with anything. They name the form's fields one by one —
 * never spreading client input — and the bound id is the one acted on.
 */

const calls = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/server/actions/accounts', () => ({
  createAccount: (input: unknown) => {
    calls.create(input);
    return Promise.resolve({ ok: true, data: { id: 'x' } });
  },
  updateAccount: (input: unknown) => {
    calls.update(input);
    return Promise.resolve({ ok: true, data: { id: 'x' } });
  },
  deleteAccount: (input: unknown) => {
    calls.remove(input);
    const { id } = input as { id: string };
    const count = Number(/^busy-(\d+)$/.exec(id)?.[1] ?? Number.NaN);
    return Promise.resolve(
      id === 'gone'
        ? { ok: false, error: { kind: 'not_found', entity: 'account' } }
        : Number.isNaN(count)
          ? { ok: true, data: { id: 'x' } }
          : {
              ok: false,
              error: {
                kind: 'blocked',
                reason: 'account_has_transactions',
                transactionCount: count,
                suggestion: 'archive',
              },
            },
    );
  },
  archiveAccount: vi.fn(),
  restoreAccount: vi.fn(),
}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

const { create, update, remove, removeAndLeave } =
  await import('@/app/(app)/accounts/actions');

const values = {
  name: 'GCash',
  type: 'ewallet' as const,
  openingBalance: '10',
  excludeFromSafeToSpend: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('account page adapters', () => {
  it('create passes exactly the form fields, dropping anything extra', async () => {
    await create({ ...values, user_id: 'someone-else' } as typeof values);
    expect(calls.create).toHaveBeenCalledWith(values);
  });

  it('update acts on the bound id, whatever the client sends', async () => {
    await update('bound-id', {
      ...values,
      id: 'smuggled-id',
    } as typeof values);
    expect(calls.update).toHaveBeenCalledWith({ id: 'bound-id', ...values });
  });

  it('survives a client sending no values at all', async () => {
    await update('bound-id', null as unknown as typeof values);
    expect(calls.update).toHaveBeenCalledWith({
      id: 'bound-id',
      name: undefined,
      type: undefined,
      openingBalance: undefined,
      excludeFromSafeToSpend: undefined,
    });
  });

  // M3-B03: a blocked delete says why and offers Archive, counting right.
  it.each([
    ['busy-1', 'It has 1 transaction,'],
    ['busy-3', 'It has 3 transactions,'],
    ['busy-0', 'It still has transactions,'],
  ])(
    'remove explains a blocked delete (%s) and offers Archive',
    async (id, held) => {
      const result = await remove(id);
      expect(result).toEqual({
        ok: false,
        message: expect.stringContaining(held),
      });
      expect(result.ok || result.message).toContain('Archive it instead');
    },
  );

  it('removeAndLeave stays on the page when the delete is blocked', async () => {
    const result = await removeAndLeave('busy-2');
    expect(redirect).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('removeAndLeave redirects to the list only after a delete', async () => {
    await expect(removeAndLeave('ok')).rejects.toThrow(
      'redirect /accounts?deleted=1',
    );
    redirect.mockClear();
    const result = await removeAndLeave('gone');
    expect(redirect).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
