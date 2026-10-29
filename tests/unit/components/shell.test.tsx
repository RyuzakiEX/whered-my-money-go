// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The authenticated app shell — M0-F02.
 *
 * Expected values are written out literally from spec §25, not imported from
 * the nav constant: a test that reads its expectations from the code under
 * test passes whatever the code says.
 */

let pathname = '/dashboard';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const { SidebarNav } = await import('@/components/shell/sidebar-nav');
const { AddTransactionButton } =
  await import('@/components/shell/add-transaction-button');
const { MobileNav } = await import('@/components/shell/mobile-nav');

const SPEC_25 = [
  ['Dashboard', '/dashboard'],
  ['Transactions', '/transactions'],
  ['Budget', '/budget'],
  ['Goals', '/goals'],
  ['Timeline', '/timeline'],
  ['Accounts', '/accounts'],
  ['Reports', '/reports'],
  ['What If?', '/what-if'],
  ['Settings', '/settings'],
] as const;

beforeEach(() => {
  pathname = '/dashboard';
});
afterEach(cleanup);

describe('SidebarNav', () => {
  it('renders exactly the nine spec §25 items, in order, with their routes', () => {
    render(<SidebarNav />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');

    expect(
      links.map((a) => [a.dataset['label'], a.getAttribute('href')]),
    ).toEqual(SPEC_25.map(([label, href]) => [label, href]));
  });

  it('marks only the current route with aria-current="page"', () => {
    pathname = '/budget';
    render(<SidebarNav />);

    const current = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.dataset['label']).toBe('Budget');
  });

  it('treats a nested route as its section', () => {
    pathname = '/transactions/abc-123';
    render(<SidebarNav />);
    expect(screen.getByRole('link', { current: 'page' }).dataset['label']).toBe(
      'Transactions',
    );
  });

  it('does not mark a route that merely shares a prefix', () => {
    // "/goals-archive" is not inside "/goals".
    pathname = '/goals-archive';
    render(<SidebarNav />);
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('marks What If? as a V2 placeholder, visibly and in its accessible name', () => {
    render(<SidebarNav />);
    // The accessible name is what a screen reader announces; "V2" must be in
    // it, not only in a visual badge outside the link.
    const whatIf = screen.getByRole('link', { name: /What If\?.*V2/ });
    expect(whatIf.dataset['label']).toBe('What If?');
  });

  it('gives every link a visible focus style', () => {
    render(<SidebarNav />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toMatch(/focus-visible:ring/);
    }
  });
});

describe('AddTransactionButton', () => {
  it('is present, labelled, and reachable by keyboard', () => {
    render(<AddTransactionButton />);
    const button = screen.getByRole('button', { name: /add transaction/i });
    // aria-disabled, not disabled: a disabled button drops out of the tab
    // order, so a keyboard user would never learn it exists.
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('MobileNav drawer', () => {
  function renderDrawer() {
    return render(
      <MobileNav>
        <SidebarNav />
      </MobileNav>,
    );
  }

  it('opens from a labelled trigger', async () => {
    const user = userEvent.setup();
    renderDrawer();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('link')).toHaveLength(9);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay!);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the route changes', async () => {
    const user = userEvent.setup();
    const view = renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    pathname = '/goals';
    view.rerender(
      <MobileNav>
        <SidebarNav />
      </MobileNav>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the current page is chosen again', async () => {
    // Same route, so no pathname change: the click itself must close it.
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('link', { current: 'page' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps focus inside while open', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const dialog = screen.getByRole('dialog');

    // More tabs than there are focusable elements: focus must wrap, never
    // escape to the page behind.
    for (let i = 0; i < 15; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('hides the page behind it from assistive technology while open', async () => {
    // Tab cycling alone does not prove a modal: Radix loops focus even in a
    // non-modal sheet. A modal also takes the rest of the page out of the
    // accessibility tree, so a screen reader cannot wander behind it.
    const user = userEvent.setup();
    renderDrawer();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(trigger);
    expect(trigger.closest('[aria-hidden="true"]')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(trigger.closest('[aria-hidden="true"]')).toBeNull();
  });
});
