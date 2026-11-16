// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountActionResult } from '@/components/accounts/action-result';
import { RestoreAccountButton } from '@/components/accounts/restore-account-button';

/** M2-F01's restore affordance: every outcome is announced in a toast. */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function clickRestore(action: () => Promise<AccountActionResult>) {
  render(
    <RestoreAccountButton accountName="Old bank" restoreAction={action} />,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Restore Old bank' }),
  );
}

describe('RestoreAccountButton', () => {
  it('announces a restore', async () => {
    await clickRestore(() => Promise.resolve({ ok: true }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Old bank is back. Welcome home.',
      );
    });
  });

  it("shows the action's own message when it refuses", async () => {
    await clickRestore(() =>
      Promise.resolve({ ok: false, message: "We couldn't find that account." }),
    );
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't find that account.",
      );
    });
  });

  it('still says something when the request itself fails', async () => {
    await clickRestore(() => Promise.reject(new Error('Failed to fetch')));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/couldn't reach the server/),
      );
    });
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Restore Old bank',
      }).disabled,
    ).toBe(false);
  });
});
