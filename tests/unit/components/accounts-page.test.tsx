// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Static, not imported inside a test: a cold import of the page and its
// client components can outlast the first test's timeout. vi.mock is hoisted
// above it, so the page still sees the mocks.
import AccountsPage from '@/app/(app)/accounts/page';
import type { Account } from '@/lib/core/types';

/**
 * M2-F01, the accounts list. The page is an async Server Component: called
 * for its JSX, then rendered, with the reads mocked.
 */

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
const profile = { current: { currency: 'PHP' } as { currency: string } | null };
vi.mock('@/lib/server/queries/profile', () => ({
  getProfile: () =>
    Promise.resolve(
      profile.current && {
        id: 'u-1',
        email: 'ana@example.test',
        displayName: 'Ana',
        timezone: 'Asia/Manila',
        ...profile.current,
      },
    ),
}));
const listAccounts =
  vi.fn<(o?: { includeArchived?: boolean }) => Promise<Account[]>>();
vi.mock('@/lib/server/queries/accounts', () => ({
  listAccounts: (options?: { includeArchived?: boolean }) =>
    listAccounts(options),
}));
vi.mock('@/lib/server/actions/accounts', () => ({ restoreAccount: vi.fn() }));

afterEach(cleanup);
beforeEach(() => {
  profile.current = { currency: 'PHP' };
  listAccounts.mockReset();
});

let seq = 0;
function account(overrides: Partial<Account> = {}): Account {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name: `Account ${String(seq)}`,
    type: 'cash',
    currency: 'PHP',
    openingBalanceMinor: 0,
    balanceMinor: 0,
    excludeFromSafeToSpend: false,
    archivedAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

const plain = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

async function renderPage(search: Record<string, string> = {}) {
  return render(await AccountsPage({ searchParams: Promise.resolve(search) }));
}

describe('accounts list (M2-F01)', () => {
  it('shows an empty state with an Add account button, and no total', async () => {
    listAccounts.mockResolvedValue([]);
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Accounts' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: /No accounts yet/ }),
    ).toBeTruthy();
    expect(screen.getByText(/anywhere your money lives/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add account' })).toHaveLength(
      1,
    );
    expect(screen.queryByTestId('spendable-total')).toBeNull();
    expect(screen.queryByRole('link', { name: /archived/i })).toBeNull();
  });

  it('reads archived accounts in the same single query', async () => {
    listAccounts.mockResolvedValue([]);
    await renderPage();
    expect(listAccounts).toHaveBeenCalledTimes(1);
    expect(listAccounts).toHaveBeenCalledWith({ includeArchived: true });
  });

  it('totals the spendable accounts, formatted in the profile currency', async () => {
    listAccounts.mockResolvedValue([
      account({ name: 'Cash', balanceMinor: 150_050 }),
      account({ name: 'BPI', type: 'bank', balanceMinor: 2_000_000 }),
      account({ name: 'GCash', type: 'ewallet', balanceMinor: 75_025 }),
      account({
        name: 'Emergency fund',
        type: 'savings',
        balanceMinor: 10_000_000,
        excludeFromSafeToSpend: true,
      }),
    ]);
    await renderPage();
    expect(plain(screen.getByTestId('spendable-total').textContent)).toBe(
      '₱22,250.75',
    );
    expect(
      screen.getByText(/Across 3 accounts you can spend from\./).textContent,
    ).toMatch(/1 set-aside account is not counted\./);
  });

  it('renders one card per account: one named link, type, and balance', async () => {
    const gcash = account({
      name: 'GCash',
      type: 'ewallet',
      balanceMinor: 123_456,
    });
    listAccounts.mockResolvedValue([gcash]);
    await renderPage();
    const card = screen.getByRole('article');
    const links = within(card).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('GCash');
    expect(links[0]?.getAttribute('href')).toBe(`/accounts/${gcash.id}`);
    expect(within(card).getByText('E-wallet')).toBeTruthy();
    expect(plain(card.textContent)).toContain('Balance: ₱1,234.56');
  });

  it('shows a negative balance with a minus sign, in the destructive colour', async () => {
    listAccounts.mockResolvedValue([
      account({ name: 'Visa', type: 'credit_card', balanceMinor: -350_000 }),
    ]);
    await renderPage();
    const balance = within(screen.getByRole('article')).getByText(/₱3,500\.00/);
    expect(plain(balance.textContent)).toBe('Balance: -₱3,500.00');
    expect(balance.className).toContain('text-destructive');
  });

  it('badges an account excluded from Safe to Spend, and only that one', async () => {
    listAccounts.mockResolvedValue([
      account({ name: 'Wallet' }),
      account({ name: 'Fund', type: 'savings', excludeFromSafeToSpend: true }),
    ]);
    await renderPage();
    const badges = screen.getAllByText('Not counted in Safe to Spend');
    expect(badges).toHaveLength(1);
    expect(badges[0]?.closest('article')?.textContent).toContain('Fund');
  });

  it('shows no total, and says why, when accounts mix currencies', async () => {
    listAccounts.mockResolvedValue([
      account({ name: 'Peso wallet', balanceMinor: 100_000 }),
      account({ name: 'Dollar account', currency: 'USD', balanceMinor: 5_000 }),
    ]);
    await renderPage();
    expect(screen.queryByTestId('spendable-total')).toBeNull();
    expect(
      screen.getByText(/aren.t in PHP, your profile currency/),
    ).toBeTruthy();
    // Each card still shows its own balance, in its own currency.
    expect(plain(document.body.textContent)).toContain('$50.00');
  });

  it('names the profile currency when every account is in another one', async () => {
    // A currency change in Settings: all accounts USD, the profile PHP.
    listAccounts.mockResolvedValue([
      account({ name: 'Checking', currency: 'USD', balanceMinor: 5_000 }),
      account({ name: 'Wallet', currency: 'USD', balanceMinor: 1_000 }),
    ]);
    await renderPage();
    expect(screen.queryByTestId('spendable-total')).toBeNull();
    expect(
      screen.getByText(/aren.t in PHP, your profile currency/),
    ).toBeTruthy();
    expect(screen.queryByText(/Across/)).toBeNull();
  });

  it('says so plainly when every active account is set aside', async () => {
    listAccounts.mockResolvedValue([
      account({
        type: 'savings',
        balanceMinor: 500_000,
        excludeFromSafeToSpend: true,
      }),
    ]);
    await renderPage();
    expect(plain(screen.getByTestId('spendable-total').textContent)).toBe(
      '₱0.00',
    );
    expect(
      screen.getByText(
        'All your accounts are set aside, so none count as spendable.',
      ),
    ).toBeTruthy();
  });

  describe('archived accounts', () => {
    const active = () => account({ name: 'Wallet', balanceMinor: 100_000 });
    const old = () =>
      account({
        name: 'Old bank',
        type: 'bank',
        balanceMinor: 900_000,
        archivedAt: '2026-11-01T01:00:00Z',
      });

    it('are hidden by default, behind a toggle that sets the URL', async () => {
      listAccounts.mockResolvedValue([active(), old()]);
      await renderPage();
      expect(screen.queryByText('Old bank')).toBeNull();
      const toggle = screen.getByRole('link', {
        name: 'Show archived accounts',
      });
      expect(toggle.getAttribute('href')).toBe('/accounts?archived=1');
      // ...and stay out of the total.
      expect(plain(screen.getByTestId('spendable-total').textContent)).toBe(
        '₱1,000.00',
      );
    });

    it('show de-emphasised with a restore button when the URL asks', async () => {
      listAccounts.mockResolvedValue([active(), old()]);
      await renderPage({ archived: '1' });
      const card = screen.getByText('Old bank').closest('article');
      if (!card) throw new Error('the archived card did not render');
      expect(card.getAttribute('data-archived')).toBe('true');
      expect(
        within(card).getByRole('button', {
          name: 'Restore Old bank',
        }),
      ).toBeTruthy();
      expect(
        screen
          .getByRole('link', { name: 'Hide archived accounts' })
          .getAttribute('href'),
      ).toBe('/accounts');
      expect(plain(screen.getByTestId('spendable-total').textContent)).toBe(
        '₱1,000.00',
      );
    });

    it('fall back to hidden for a hand-edited value', async () => {
      listAccounts.mockResolvedValue([active(), old()]);
      await renderPage({ archived: 'yes please' });
      expect(screen.queryByText('Old bank')).toBeNull();
    });

    it('show the toggle even when every account is archived', async () => {
      listAccounts.mockResolvedValue([old()]);
      await renderPage();
      // Not "no accounts yet": they have one, it is archived.
      expect(
        screen.queryByRole('heading', { name: /No accounts yet/ }),
      ).toBeNull();
      expect(
        screen.getByRole('heading', { name: 'No active accounts right now.' }),
      ).toBeTruthy();
      expect(
        screen.getByRole('link', { name: 'Show archived accounts' }),
      ).toBeTruthy();
    });
  });

  it('signs a session with no profile out', async () => {
    profile.current = null;
    listAccounts.mockResolvedValue([]);
    await expect(renderPage()).rejects.toThrow('redirect /auth/signout');
  });
});
