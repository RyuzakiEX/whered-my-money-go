// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Every spec §25 route exists and renders its name — and the shell around
 * them has the landmarks and the primary action. Page and layout modules are
 * plain functions returning JSX, so they render here without a Next server.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
// The layout reads the profile and passes the sign-out action down (M1-F04).
const profileStub = { current: true };
vi.mock('@/lib/server/queries/profile', () => ({
  getProfile: () =>
    !profileStub.current
      ? Promise.resolve(null)
      : Promise.resolve({
          id: 'u-1',
          email: 'ana@example.test',
          displayName: 'Ana',
          currency: 'PHP',
          timezone: 'Asia/Manila',
        }),
  displayNameOf: (p: { displayName: string | null }) => p.displayName ?? 'You',
}));
vi.mock('@/lib/server/actions/auth', () => ({ signOut: vi.fn() }));

afterEach(cleanup);

const ROUTES: [string, string, () => Promise<{ default: ComponentType }>][] = [
  ['Dashboard', 'dashboard', () => import('@/app/(app)/dashboard/page')],
  [
    'Transactions',
    'transactions',
    () => import('@/app/(app)/transactions/page'),
  ],
  ['Budget', 'budget', () => import('@/app/(app)/budget/page')],
  ['Goals', 'goals', () => import('@/app/(app)/goals/page')],
  ['Timeline', 'timeline', () => import('@/app/(app)/timeline/page')],
  ['Accounts', 'accounts', () => import('@/app/(app)/accounts/page')],
  ['Reports', 'reports', () => import('@/app/(app)/reports/page')],
  ['What If?', 'what-if', () => import('@/app/(app)/what-if/page')],
  ['Settings', 'settings', () => import('@/app/(app)/settings/page')],
];

describe('placeholder routes', () => {
  it.each(ROUTES)(
    '%s renders its name as the page heading',
    async (name, _, load) => {
      const { default: Page } = await load();
      render(<Page />);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(name);
    },
  );
});

describe('app shell layout', () => {
  async function renderShell() {
    const { default: AppLayout } = await import('@/app/(app)/layout');
    // An async Server Component: call it for its JSX, then render that.
    return render(await AppLayout({ children: <h1>Dashboard</h1> }));
  }

  it('renders the page inside a single <main>', async () => {
    await renderShell();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe(
      'Dashboard',
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('renders the sidebar navigation and the mobile drawer trigger', async () => {
    await renderShell();
    // One persistent sidebar nav; the drawer's copy only mounts when opened.
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toBeTruthy();
  });

  it('offers + Add Transaction (desktop sidebar and mobile bar)', async () => {
    await renderShell();
    // Both are in the DOM; CSS shows one per breakpoint (jsdom has no layout,
    // so which one is visible is E2E's to check).
    expect(
      screen.getAllByRole('button', { name: /add transaction/i }),
    ).toHaveLength(2);
  });
});

describe('app shell without a profile', () => {
  it('signs the session out instead of rendering or looping to /login', async () => {
    // Code review of #56: a valid token with no profile row used to throw on
    // every page; /login would bounce back here through the proxy.
    profileStub.current = false;
    const { default: AppLayout } = await import('@/app/(app)/layout');
    await expect(AppLayout({ children: null })).rejects.toThrow(
      'redirect /auth/signout',
    );
    profileStub.current = true;
  });
});
