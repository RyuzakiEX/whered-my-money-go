// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ProfileForm,
  type ProfileSaveResult,
  type ProfileValues,
} from '@/components/settings/profile-form';

/**
 * M1-F05. The optimistic save and, above all, its rollback: the task asks for
 * a test that forces the action to reject.
 */

afterEach(cleanup);

const initial: ProfileValues = {
  displayName: 'Ana',
  currency: 'PHP',
  timezone: 'Asia/Manila',
};
const ZONES = ['Asia/Manila', 'America/New_York', 'Europe/Berlin'];

/** An action whose outcome the test decides, after observing the optimistic state. */
function controlledAction() {
  let settle: (result: ProfileSaveResult) => void = () => undefined;
  const action = (): Promise<ProfileSaveResult> => {
    return new Promise<ProfileSaveResult>((resolve) => {
      settle = resolve;
    });
  };
  return {
    action,
    settle: (result: ProfileSaveResult) => {
      settle(result);
    },
  };
}

function shown(field: 'name' | 'currency' | 'timezone') {
  return screen.getByTestId(`shown-${field}`).textContent;
}

describe('ProfileForm', () => {
  it('keeps Save disabled until something changes', async () => {
    const user = userEvent.setup();
    render(
      <ProfileForm
        initial={initial}
        timezones={ZONES}
        saveAction={controlledAction().action}
      />,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText('Name'), '!');
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the new values at once, then rolls them back and says so when the save fails', async () => {
    const user = userEvent.setup();
    const { action, settle } = controlledAction();
    render(
      <ProfileForm initial={initial} timezones={ZONES} saveAction={action} />,
    );

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Bea');
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Optimistic: shown as saved before the server has answered.
    await waitFor(() => {
      expect(shown('name')).toBe('Bea');
    });
    expect(shown('currency')).toBe('USD');
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();

    await act(async () => {
      settle({ ok: false, message: 'The server said no.' });
      await Promise.resolve();
    });

    // Rolled back: the summary and the inputs show the saved values again.
    await waitFor(() => {
      expect(shown('name')).toBe('Ana');
    });
    expect(shown('currency')).toBe('PHP');
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Ana');
    expect(screen.getByLabelText<HTMLSelectElement>('Currency').value).toBe(
      'PHP',
    );
    // And the failure is announced.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('The server said no.');
  });

  it('keeps the new values and confirms politely when the save succeeds', async () => {
    const user = userEvent.setup();
    const { action, settle } = controlledAction();
    render(
      <ProfileForm initial={initial} timezones={ZONES} saveAction={action} />,
    );

    await user.selectOptions(screen.getByLabelText('Currency'), 'JPY');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      settle({ ok: true, data: { ...initial, currency: 'JPY' } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Saved. Looking good.',
      );
    });
    expect(shown('currency')).toBe('JPY');
    // Saved again equals current, so Save is disabled until the next change.
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled,
    ).toBe(true);
  });

  it('explains that changing currency does not convert amounts', async () => {
    const user = userEvent.setup();
    render(
      <ProfileForm
        initial={initial}
        timezones={ZONES}
        saveAction={controlledAction().action}
      />,
    );
    expect(screen.queryByText(/won't convert/)).toBeNull();

    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
    expect(screen.getByText(/won't convert/)).toBeTruthy();
    expect(
      screen.getByLabelText('Currency').getAttribute('aria-describedby'),
    ).toBe('currency-note');
  });

  it('refuses an unknown timezone without calling the server', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const action = () => {
      calls++;
      return Promise.resolve<ProfileSaveResult>({ ok: false });
    };
    render(
      <ProfileForm initial={initial} timezones={ZONES} saveAction={action} />,
    );

    const timezone = screen.getByLabelText('Timezone');
    await user.clear(timezone);
    await user.type(timezone, 'Not/AZone');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(calls).toBe(0);
    expect(document.getElementById('timezone-error')?.textContent).toMatch(
      /couldn't find that timezone/,
    );
  });
});
