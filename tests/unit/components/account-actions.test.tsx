// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountActionsMenu } from '@/components/accounts/account-actions-menu';
import type { AccountActionResult } from '@/components/accounts/action-result';
import { ActiveAccountList } from '@/components/accounts/active-account-list';
import type { Account } from '@/lib/core/types';

/** M2-F03: the archive and delete flow. */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Settle = (result: AccountActionResult) => void;

/** An action whose outcome the test decides, after observing the pending state. */
function controlled() {
  let settle: Settle = () => undefined;
  const action = vi.fn(
    () =>
      new Promise<AccountActionResult>((resolve) => {
        settle = resolve;
      }),
  );
  return {
    action,
    settle: async (result: AccountActionResult) => {
      await act(async () => {
        settle(result);
        await Promise.resolve();
      });
    },
  };
}

async function openMenu(name: string) {
  screen.getByRole('button', { name: `Actions for ${name}` }).focus();
  await userEvent.keyboard('{Enter}');
  return screen.getByRole('menu');
}

describe('AccountActionsMenu', () => {
  it('offers Archive and Delete from a named trigger', async () => {
    render(
      <AccountActionsMenu
        accountName="GCash"
        onArchive={vi.fn()}
        deleteAction={vi.fn()}
      />,
    );
    const menu = await openMenu('GCash');
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Archive', 'Delete']);
    expect(menu).toBeTruthy();
  });

  it('portals the open menu into <main>, outside the card', async () => {
    render(
      <main>
        <div data-testid="card" className="relative z-10">
          <AccountActionsMenu
            accountName="GCash"
            onArchive={vi.fn()}
            deleteAction={vi.fn()}
          />
        </div>
      </main>,
    );
    const menu = await openMenu('GCash');
    expect(menu.closest('main')).toBeTruthy();
    expect(screen.getByTestId('card').contains(menu)).toBe(false);
  });

  it('offers only Delete for an archived account', async () => {
    render(<AccountActionsMenu accountName="Old" deleteAction={vi.fn()} />);
    await openMenu('Old');
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Delete']);
  });

  it('archives straight away, with no second confirmation', async () => {
    const onArchive = vi.fn();
    render(
      <AccountActionsMenu
        accountName="GCash"
        onArchive={onArchive}
        deleteAction={vi.fn()}
      />,
    );
    await openMenu('GCash');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  describe('delete confirmation', () => {
    async function openDelete(
      deleteAction: () => Promise<AccountActionResult>,
    ) {
      render(
        <AccountActionsMenu
          accountName="GCash"
          onArchive={vi.fn()}
          deleteAction={deleteAction}
        />,
      );
      await openMenu('GCash');
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      return screen.getByRole('alertdialog', { name: 'Delete GCash?' });
    }

    it('names the account, says it is irreversible, and focuses Cancel', async () => {
      const dialog = await openDelete(vi.fn());
      expect(dialog.textContent).toContain("can't be undone");
      expect(dialog.textContent).toContain('archive it instead');
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Keep it' }),
      );
      // Not by colour alone: the confirm says what it does.
      expect(
        screen.getByRole('button', { name: 'Delete account' }).className,
      ).toContain('destructive');
    });

    it('deletes only on the explicit confirm, then closes and says so', async () => {
      const deleteAction = vi.fn(() =>
        Promise.resolve<AccountActionResult>({ ok: true }),
      );
      await openDelete(deleteAction);
      expect(deleteAction).not.toHaveBeenCalled();
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete account' }),
      );
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
      expect(deleteAction).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith('GCash deleted. Clean slate.');
    });

    it('returns focus to the menu trigger when it closes', async () => {
      await openDelete(vi.fn());
      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole('button', { name: 'Actions for GCash' }),
        );
      });
    });

    it('Cancel closes it without deleting', async () => {
      const deleteAction = vi.fn();
      await openDelete(deleteAction);
      await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
      expect(deleteAction).not.toHaveBeenCalled();
    });

    it('stays open on a refusal, showing the reason, and cannot close mid-delete', async () => {
      const { action, settle } = controlled();
      await openDelete(action);
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete account' }),
      );
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Deleting…' })
          .disabled,
      ).toBe(true);
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog')).toBeTruthy();

      await settle({ ok: false, message: "We couldn't find that account." });
      expect(
        (
          await screen.findByText("We couldn't find that account.")
        ).getAttribute('role'),
      ).toBe('alert');
      expect(screen.getByRole('alertdialog')).toBeTruthy();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('does not claim nothing happened when the request itself fails', async () => {
      await openDelete(() => Promise.reject(new Error('offline')));
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete account' }),
      );
      expect(
        await screen.findByText(/couldn't confirm that with the server/),
      ).toBeTruthy();
      // The delete may have committed: show the truth, don't guess.
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it('hands focus to the caller after a delete, not to its own trigger', async () => {
      const onDeleted = vi.fn();
      render(
        <AccountActionsMenu
          accountName="GCash"
          onArchive={vi.fn()}
          deleteAction={() => Promise.resolve({ ok: true })}
          onDeleted={onDeleted}
        />,
      );
      await openMenu('GCash');
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete account' }),
      );
      await waitFor(() => {
        expect(onDeleted).toHaveBeenCalledTimes(1);
      });
      expect(document.activeElement).not.toBe(
        screen.queryByRole('button', { name: 'Actions for GCash' }),
      );
    });
  });
});

describe('ActiveAccountList', () => {
  const accounts: Account[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Cash',
      type: 'cash',
      currency: 'PHP',
      openingBalanceMinor: 100_000,
      balanceMinor: 100_000,
      excludeFromSafeToSpend: false,
      archivedAt: null,
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'GCash',
      type: 'ewallet',
      currency: 'PHP',
      openingBalanceMinor: 50_000,
      balanceMinor: 50_000,
      excludeFromSafeToSpend: false,
      archivedAt: null,
      createdAt: '2026-11-01T00:00:00Z',
    },
  ];

  function renderList(
    archiveAction: (id: string) => Promise<AccountActionResult>,
  ) {
    const restoreAction = vi.fn(() =>
      Promise.resolve<AccountActionResult>({ ok: true }),
    );
    render(
      <ActiveAccountList
        accounts={accounts}
        total={<p data-testid="total">₱1,500.00</p>}
        archiveAction={archiveAction}
        restoreAction={restoreAction}
        deleteAction={vi.fn()}
      />,
    );
    return { restoreAction };
  }

  async function archiveGCash() {
    await openMenu('GCash');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
  }

  it('hides the card at once, marks the total busy, never edits it', async () => {
    const { action, settle } = controlled();
    renderList(action);
    await archiveGCash();
    expect(screen.queryByRole('link', { name: 'GCash' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Cash' })).toBeTruthy();
    expect(action).toHaveBeenCalledWith(accounts[1]?.id);
    const total = screen.getByTestId('total');
    expect(total.parentElement?.getAttribute('aria-busy')).toBe('true');
    expect(total.textContent).toBe('₱1,500.00');
    await settle({ ok: true });
  });

  it('moves focus to the list heading, since the card it was on is gone', async () => {
    renderList(() => Promise.resolve({ ok: true }));
    await archiveGCash();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Your accounts' }),
      );
    });
  });

  it('refreshes rather than guess when the archive request fails outright', async () => {
    renderList(() => Promise.reject(new Error('offline')));
    await archiveGCash();
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/couldn't confirm/),
      );
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('confirms with an Undo that restores the account', async () => {
    const { restoreAction } = renderList(() => Promise.resolve({ ok: true }));
    await archiveGCash();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    const [message, options] = toast.success.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("GCash archived. It's resting, not gone.");
    expect(options.action.label).toBe('Undo');
    options.action.onClick();
    expect(restoreAction).toHaveBeenCalledWith(accounts[1]?.id);
    await waitFor(() => {
      expect(toast.success).toHaveBeenLastCalledWith('GCash is back.');
    });
  });

  it('rolls back on failure: the card returns and the reason is shown', async () => {
    const { action, settle } = controlled();
    renderList(action);
    await archiveGCash();
    expect(screen.queryByRole('link', { name: 'GCash' })).toBeNull();
    await settle({ ok: false, message: 'Something went wrong on our side.' });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'GCash' })).toBeTruthy();
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Something went wrong on our side.',
    );
    expect(
      screen.getByTestId('total').parentElement?.getAttribute('aria-busy'),
    ).toBeNull();
  });
});
