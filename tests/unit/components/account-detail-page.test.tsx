// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Static, so a cold import cannot outlast the first test; vi.mock is hoisted.
import AccountPage, { generateMetadata } from '@/app/(app)/accounts/[id]/page';
import { AccountDetailActions } from '@/components/accounts/account-detail-actions';
import type { Account } from '@/lib/core/types';

/** M2-F04: an account's own page. */

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error('not found');
  },
  useRouter: () => router,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/server/queries/profile', () => ({
  getProfile: () =>
    Promise.resolve({
      id: 'u-1',
      email: 'ana@example.test',
      displayName: 'Ana',
      currency: 'PHP',
      timezone: 'Asia/Manila',
    }),
}));
const getAccount = vi.fn<(id: string) => Promise<Account | null>>();
vi.mock('@/lib/server/queries/accounts', () => ({
  getAccount: (id: string) => getAccount(id),
}));
vi.mock('@/lib/server/actions/accounts', () => ({}));

const ID = '00000000-0000-4000-8000-000000000001';

const gcash: Account = {
  id: ID,
  name: 'GCash',
  type: 'ewallet',
  currency: 'PHP',
  openingBalanceMinor: 100_050,
  balanceMinor: 100_050,
  excludeFromSafeToSpend: false,
  archivedAt: null,
  // 17:30 UTC on 31 October: 1 November in Manila.
  createdAt: '2026-10-31T17:30:00Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  getAccount.mockResolvedValue(gcash);
});

const plain = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

async function renderPage(id = ID) {
  return render(await AccountPage({ params: Promise.resolve({ id }) }));
}

describe('account page (M2-F04)', () => {
  it('shows the account: name, type, currency, balances, date added', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'GCash' }),
    ).toBeTruthy();
    expect(plain(screen.getByTestId('current-balance').textContent)).toBe(
      '₱1,000.50',
    );
    expect(plain(screen.getByTestId('opening-balance').textContent)).toBe(
      '₱1,000.50',
    );
    const facts = screen.getByTestId('opening-balance').closest('dl');
    expect(facts?.textContent).toContain('E-wallet');
    expect(facts?.textContent).toContain('PHP');
    // In the profile's timezone, not UTC.
    expect(facts?.textContent).toContain('Nov 1, 2026');
    expect(getAccount).toHaveBeenCalledWith(ID);
  });

  it('has one h1 followed by section headings', async () => {
    await renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['Current balance', 'Transactions']);
  });

  it('links back to the accounts list', async () => {
    await renderPage();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(nav)
        .getByRole('link', { name: 'All accounts' })
        .getAttribute('href'),
    ).toBe('/accounts');
  });

  it('has an empty transaction history pointing at Add Transaction', async () => {
    await renderPage();
    const region = screen
      .getByRole('heading', { name: 'Transactions' })
      .closest('section');
    if (!region) throw new Error('no history region');
    expect(within(region).getByText('No transactions yet.')).toBeTruthy();
    expect(
      within(region).getByRole('button', { name: 'Add Transaction' }),
    ).toBeTruthy();
  });

  it('offers Edit and the actions menu on an active account', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Actions for GCash' }),
    ).toBeTruthy();
    expect(screen.queryByText('This account is archived')).toBeNull();
  });

  it('shows a negative balance with its minus sign, in the destructive colour', async () => {
    getAccount.mockResolvedValue({
      ...gcash,
      type: 'credit_card',
      balanceMinor: -350_000,
    });
    await renderPage();
    const balance = screen.getByTestId('current-balance');
    expect(plain(balance.textContent)).toBe('-₱3,500.00');
    expect(balance.className).toContain('text-destructive');
  });

  describe('an archived account', () => {
    beforeEach(() => {
      getAccount.mockResolvedValue({
        ...gcash,
        archivedAt: '2026-11-01T02:00:00Z',
      });
    });

    it('keeps the h1 first: the banner comes after the title', async () => {
      await renderPage();
      const headings = screen.getAllByRole('heading');
      expect(headings[0]?.tagName).toBe('H1');
      expect(headings.map((h) => h.textContent)).toEqual([
        'GCash',
        'This account is archived',
        'Current balance',
        'Transactions',
      ]);
    });

    it('shows the archived banner with a restore action', async () => {
      await renderPage();
      const banner = screen
        .getByRole('heading', { name: 'This account is archived' })
        .closest('section');
      if (!banner) throw new Error('no banner');
      expect(
        within(banner).getByRole('button', { name: 'Restore GCash' }),
      ).toBeTruthy();
    });

    it('disables Edit, with the reason attached', async () => {
      await renderPage();
      const edit = screen.getByRole('button', { name: 'Edit' });
      expect(edit.getAttribute('aria-disabled')).toBe('true');
      expect(edit.getAttribute('aria-describedby')).toBe(
        'edit-disabled-reason',
      );
      expect(document.getElementById('edit-disabled-reason')?.textContent).toBe(
        'Restore this account to edit it.',
      );
      await userEvent.click(edit);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('renders not-found for a missing, deleted, or foreign id alike', async () => {
    getAccount.mockResolvedValue(null);
    await expect(renderPage('another-users-id')).rejects.toThrow('not found');
  });

  it('titles the tab with the account, and gives nothing away when missing', async () => {
    expect(
      await generateMetadata({ params: Promise.resolve({ id: ID }) }),
    ).toEqual({ title: 'GCash' });
    getAccount.mockResolvedValue(null);
    expect(
      await generateMetadata({ params: Promise.resolve({ id: ID }) }),
    ).toEqual({ title: 'Account not found' });
  });
});

describe('AccountDetailActions', () => {
  const ok = () => Promise.resolve({ ok: true as const });

  it('opens the edit dialog with the saved values, balance as decimal text', async () => {
    render(
      <AccountDetailActions
        account={gcash}
        updateAction={ok}
        archiveAction={ok}
        restoreAction={ok}
        deleteAction={ok}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit GCash' });
    expect(
      within(dialog).getByLabelText<HTMLInputElement>('Opening balance').value,
    ).toBe('1000.50');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Type').value).toBe(
      'ewallet',
    );
  });

  it('cannot be reopened while an archive is in flight', async () => {
    let settle: (r: { ok: true }) => void = () => undefined;
    render(
      <AccountDetailActions
        account={gcash}
        updateAction={ok}
        archiveAction={() =>
          new Promise((resolve) => {
            settle = resolve;
          })
        }
        restoreAction={ok}
        deleteAction={ok}
      />,
    );
    const trigger = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Actions for GCash',
    });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => {
      expect(trigger.disabled).toBe(true);
    });
    await act(async () => {
      settle({ ok: true });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(trigger.disabled).toBe(false);
    });
  });

  it('offers only Delete for an archived account', async () => {
    render(
      <AccountDetailActions
        account={{ ...gcash, archivedAt: '2026-11-01T02:00:00Z' }}
        updateAction={ok}
        archiveAction={ok}
        restoreAction={ok}
        deleteAction={ok}
      />,
    );
    screen.getByRole('button', { name: 'Actions for GCash' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Delete']);
  });
});
