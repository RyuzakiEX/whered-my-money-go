// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeletedNotice } from '@/components/accounts/deleted-notice';

/** M2-F04: a delete on the detail page is confirmed on the list. */

const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

afterEach(cleanup);

describe('DeletedNotice', () => {
  it('confirms once, under a fixed id, and drops the flag from the URL', () => {
    render(<DeletedNotice />);
    expect(toast.success).toHaveBeenCalledWith(
      'Account deleted. Clean slate.',
      { id: 'account-deleted' },
    );
    expect(router.replace).toHaveBeenCalledWith('/accounts', { scroll: false });
  });
});
