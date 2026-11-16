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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountDialog } from '@/components/accounts/account-dialog';
import {
  AccountForm,
  EMPTY_ACCOUNT,
  type AccountFormValues,
  type AccountSaveResult,
} from '@/components/accounts/account-form';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { formatMinorForInput } from '@/lib/utils/format-money';
import {
  accountCreateSchema,
  accountUpdateSchema,
} from '@/lib/validation/accounts';

/** M2-F02: one form for create and edit, inside an accessible dialog. */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ID = '00000000-0000-4000-8000-000000000001';

type Save = (values: AccountFormValues) => Promise<AccountSaveResult>;

/** The form needs a dialog around it: its footer closes the dialog. */
function renderForm(
  props: Partial<Parameters<typeof AccountForm>[0]> & {
    saveAction?: Save;
  } = {},
) {
  const saveAction = vi.fn<Save>(
    props.saveAction ?? (() => Promise.resolve({ ok: true })),
  );
  const onSaved = vi.fn();
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Account</DialogTitle>
        <AccountForm
          mode="create"
          initial={EMPTY_ACCOUNT}
          currency="PHP"
          {...props}
          saveAction={saveAction}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>,
  );
  return { saveAction, onSaved };
}

const nameInput = () => screen.getByLabelText<HTMLInputElement>('Name');
const balanceInput = () =>
  screen.getByLabelText<HTMLInputElement>('Opening balance');
const typeSelect = () => screen.getByLabelText('Type');
const excludeBox = () =>
  screen.getByRole<HTMLInputElement>('checkbox', {
    name: /Leave out of Safe to Spend/,
  });
const submit = (name = 'Add account') =>
  screen.getByRole<HTMLButtonElement>('button', { name });

describe('AccountForm fields', () => {
  it('offers the six types, with e-wallet naming GCash and Maya', () => {
    renderForm();
    const options = within(typeSelect()).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Cash',
      'Bank',
      'E-wallet (GCash, Maya)',
      'Credit card',
      'Savings',
      'Other',
    ]);
  });

  it('takes the balance as decimal text, with the currency symbol beside it', () => {
    renderForm();
    expect(balanceInput().getAttribute('inputmode')).toBe('decimal');
    expect(balanceInput().parentElement?.textContent).toContain('₱');
  });

  it('shows the currency read-only, never as an input', () => {
    renderForm();
    expect(screen.getByText('PHP (₱)')).toBeTruthy();
    expect(screen.queryByLabelText('Currency')).toBeNull();
    expect(screen.getByText(/uses your profile currency/)).toBeTruthy();
  });

  it('explains the Safe to Spend checkbox in one line', () => {
    renderForm();
    expect(excludeBox().getAttribute('aria-describedby')).toBe(
      'excludeFromSafeToSpend-description',
    );
    expect(
      screen.getByText(/setting aside, like an emergency fund/),
    ).toBeTruthy();
  });
});

describe('AccountForm opening balance round-trips (shared parser)', () => {
  it.each(['1000.5', '1,000.50'])(
    'create: %s is sent as text the action parses to 100050',
    async (typed) => {
      const { saveAction } = renderForm();
      await userEvent.type(nameInput(), 'GCash');
      await userEvent.type(balanceInput(), typed);
      await userEvent.click(submit());
      await waitFor(() => {
        expect(saveAction).toHaveBeenCalledTimes(1);
      });
      const sent = saveAction.mock.calls[0]?.[0];
      expect(sent?.openingBalance).toBe(typed);
      expect(accountCreateSchema('PHP').parse(sent).openingBalanceMinor).toBe(
        100_050,
      );
    },
  );

  it('edit: a saved 100050 shows as 1000.50 and saves back as 100050', async () => {
    const initial: AccountFormValues = {
      name: 'GCash',
      type: 'ewallet',
      openingBalance: formatMinorForInput(100_050, 'PHP'),
      excludeFromSafeToSpend: false,
    };
    const { saveAction } = renderForm({ mode: 'edit', accountId: ID, initial });
    expect(balanceInput().value).toBe('1000.50');
    await userEvent.type(nameInput(), ' wallet');
    await userEvent.click(submit('Save changes'));
    await waitFor(() => {
      expect(saveAction).toHaveBeenCalledTimes(1);
    });
    const sent = saveAction.mock.calls[0]?.[0];
    expect(
      accountUpdateSchema('PHP').parse({ ...sent, id: ID }).openingBalanceMinor,
    ).toBe(100_050);
  });

  it('parses in the account currency: JPY has no decimals', async () => {
    const { saveAction } = renderForm({ currency: 'JPY' });
    await userEvent.type(nameInput(), 'Yen');
    await userEvent.type(balanceInput(), '1000.5');
    await userEvent.click(submit());
    expect(saveAction).not.toHaveBeenCalled();
    expect(
      screen.getByText('JPY amounts have no decimal places.'),
    ).toBeTruthy();
  });
});

describe('AccountForm validation', () => {
  it('keeps submit disabled while pristine', async () => {
    renderForm();
    expect(submit().disabled).toBe(true);
    await userEvent.type(nameInput(), 'x');
    expect(submit().disabled).toBe(false);
    await userEvent.clear(nameInput());
    expect(submit().disabled).toBe(true);
  });

  it('shows a field error on blur, tied to the input', async () => {
    renderForm();
    await userEvent.type(balanceInput(), 'abc');
    await userEvent.tab();
    const error = screen.getByText(/doesn.t look like an amount/);
    expect(balanceInput().getAttribute('aria-invalid')).toBe('true');
    expect(balanceInput().getAttribute('aria-describedby')).toContain(error.id);
  });

  it('does not flag a field the user tabbed past without typing', async () => {
    renderForm();
    await userEvent.click(nameInput());
    await userEvent.tab();
    expect(nameInput().getAttribute('aria-invalid')).toBeNull();
  });

  it('on submit, stops on the first problem and focuses it', async () => {
    const { saveAction } = renderForm();
    await userEvent.type(balanceInput(), '50');
    await userEvent.click(submit());
    expect(saveAction).not.toHaveBeenCalled();
    expect(screen.getByText('Give the account a name.')).toBeTruthy();
    expect(document.activeElement).toBe(nameInput());
  });

  it("puts the server's taken-name error on the name field", async () => {
    const { saveAction, onSaved } = renderForm({
      saveAction: () =>
        Promise.resolve({
          ok: false,
          fields: {
            name: [
              'You already have an account called "GCash". Pick a different name.',
            ],
          },
        }),
    });
    await userEvent.type(nameInput(), 'gcash');
    await userEvent.type(balanceInput(), '0');
    await userEvent.click(submit());
    await waitFor(() => {
      expect(saveAction).toHaveBeenCalled();
    });
    const error = await screen.findByText(/already have an account called/);
    expect(nameInput().getAttribute('aria-describedby')).toContain(error.id);
    expect(document.activeElement).toBe(nameInput());
    // On the field, not as a generic banner: the only alert is the field's.
    expect(screen.getAllByRole('alert')).toEqual([error]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps what was typed when the request itself fails', async () => {
    renderForm({ saveAction: () => Promise.reject(new Error('offline')) });
    await userEvent.type(nameInput(), 'BPI');
    await userEvent.type(balanceInput(), '25');
    await userEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /couldn.t confirm that saved/,
    );
    expect(nameInput().value).toBe('BPI');
    expect(balanceInput().value).toBe('25');
  });

  it('disables submit while the save is in flight', async () => {
    let settle: (r: AccountSaveResult) => void = () => undefined;
    renderForm({
      saveAction: () =>
        new Promise<AccountSaveResult>((resolve) => {
          settle = resolve;
        }),
    });
    await userEvent.type(nameInput(), 'BPI');
    await userEvent.type(balanceInput(), '25');
    await userEvent.click(submit());
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Saving…',
    });
    expect(button.disabled).toBe(true);
    await act(async () => {
      settle({ ok: true });
      await Promise.resolve();
    });
  });
});

describe('AccountForm defaults and notes', () => {
  it('starts a savings account excluded, until the user decides', async () => {
    renderForm();
    expect(excludeBox().checked).toBe(false);
    await userEvent.selectOptions(typeSelect(), 'savings');
    expect(excludeBox().checked).toBe(true);
    await userEvent.selectOptions(typeSelect(), 'bank');
    expect(excludeBox().checked).toBe(false);

    await userEvent.click(excludeBox());
    await userEvent.selectOptions(typeSelect(), 'savings');
    await userEvent.selectOptions(typeSelect(), 'cash');
    expect(excludeBox().checked).toBe(true);
  });

  it('edit: warns that the balance will shift when the opening balance changes', async () => {
    renderForm({
      mode: 'edit',
      accountId: ID,
      initial: { ...EMPTY_ACCOUNT, name: 'Cash', openingBalance: '100.00' },
    });
    expect(screen.queryByText(/will shift/)).toBeNull();
    await userEvent.clear(balanceInput());
    await userEvent.type(balanceInput(), '150');
    expect(screen.getByText(/will shift by the same amount/)).toBeTruthy();
    expect(balanceInput().getAttribute('aria-describedby')).toContain(
      'openingBalance-note',
    );
  });
});

describe('AccountForm edit-mode comparisons', () => {
  it('treats the same amount written differently as no change', async () => {
    renderForm({
      mode: 'edit',
      accountId: ID,
      initial: { ...EMPTY_ACCOUNT, name: 'Cash', openingBalance: '1000.50' },
    });
    await userEvent.clear(balanceInput());
    await userEvent.type(balanceInput(), '1,000.50');
    expect(screen.queryByText(/will shift/)).toBeNull();
    expect(submit('Save changes').disabled).toBe(true);
  });
});

describe('AccountDialog', () => {
  it('closes on Escape straight after a refused save', async () => {
    render(
      <AccountDialog
        mode="create"
        currency="PHP"
        saveAction={() =>
          Promise.resolve({ ok: false, fields: { name: ['Taken.'] } })
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'BPI');
    await userEvent.type(within(dialog).getByLabelText('Opening balance'), '1');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Add account' }),
    );
    // As soon as the error has focus — no waiting for anything else.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(dialog).getByLabelText('Name'),
      );
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('cannot be closed while a save is in flight', async () => {
    let settle: (r: AccountSaveResult) => void = () => undefined;
    render(
      <AccountDialog
        mode="create"
        currency="PHP"
        saveAction={() =>
          new Promise<AccountSaveResult>((resolve) => {
            settle = resolve;
          })
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'BPI');
    await userEvent.type(within(dialog).getByLabelText('Opening balance'), '1');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Add account' }),
    );
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancel' })
        .disabled,
    ).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();

    await act(async () => {
      settle({ ok: false, message: 'Server said no.' });
      await Promise.resolve();
    });
    // The outcome is shown, in the dialog that is still open.
    expect(await within(dialog).findByText('Server said no.')).toBeTruthy();
  });

  it('moves focus to the live trigger when saving replaced its own', async () => {
    // The first account swaps the empty state for the list: the trigger the
    // user clicked unmounts, and the header's takes its place.
    const { rerender } = render(
      <AccountDialog
        mode="create"
        currency="PHP"
        saveAction={() => Promise.resolve({ ok: true })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    rerender(
      <button type="button" data-account-trigger="create">
        Header trigger
      </button>,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Header trigger' }),
      );
    });
  });

  it('opens from its trigger, closes on Escape, and returns focus', async () => {
    render(
      <AccountDialog
        mode="create"
        currency="PHP"
        saveAction={() => Promise.resolve({ ok: true })}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Add account' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Add an account' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('closes on success and announces it', async () => {
    render(
      <AccountDialog
        mode="create"
        currency="PHP"
        saveAction={() => Promise.resolve({ ok: true })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), ' GCash ');
    await userEvent.type(
      within(dialog).getByLabelText('Opening balance'),
      '500',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Add account' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(toast.success).toHaveBeenCalledWith(
      "GCash is in. We'll keep count.",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Add account' }),
      );
    });
  });

  it('edit mode starts from the account and names it in the title', async () => {
    render(
      <AccountDialog
        mode="edit"
        accountId={ID}
        initial={{ ...EMPTY_ACCOUNT, name: 'BPI', openingBalance: '10.00' }}
        currency="PHP"
        saveAction={() => Promise.resolve({ ok: true })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit BPI' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'BPI',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    ).toBeTruthy();
  });
});
