// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import type { FormAction, FormState } from '@/components/auth/form-parts';
import { LogInForm } from '@/components/auth/log-in-form';
import { NewPasswordForm } from '@/components/auth/new-password-form';
import {
  RESET_REQUESTED,
  ResetRequestForm,
} from '@/components/auth/reset-request-form';
import { SignUpForm } from '@/components/auth/sign-up-form';

/**
 * M1-F01/F02 form behaviour that the browser suite does not pin down: the
 * pending state (no double submit), the action receiving exactly the form's
 * fields, server errors landing on the right field, and the summary taking
 * focus. Accessibility and the real flows are in tests/e2e/auth-pages.spec.ts.
 */

/**
 * Settles every "pending" action when a test ends. React 19 entangles async
 * transitions: one left pending holds back state updates from later ones,
 * even in another render tree — so a never-resolving action in one test made
 * later tests' results never appear.
 */
const unsettled: (() => void)[] = [];

afterEach(() => {
  for (const settle of unsettled.splice(0)) settle();
  cleanup();
});

/** An action that stays pending until the test ends, to observe the pending state. */
function pendingAction(): { action: FormAction; calls: FormData[] } {
  const calls: FormData[] = [];
  const action: FormAction = (_state, formData) => {
    calls.push(formData);
    return new Promise<FormState>((resolve) => {
      unsettled.push(() => {
        resolve({});
      });
    });
  };
  return { action, calls };
}

describe('SignUpForm', () => {
  it('disables the button while submitting, so a double-click sends one request', async () => {
    const user = userEvent.setup();
    const { action, calls } = pendingAction();
    render(<SignUpForm action={action} />);

    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    const button = await screen.findByRole('button', {
      name: 'Creating your account…',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(calls).toHaveLength(1);
  });

  it('sends the form fields, and does not send an invalid form at all', async () => {
    const user = userEvent.setup();
    const { action, calls } = pendingAction();
    render(<SignUpForm action={action} />);

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create my account' }));
    expect(calls).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create my account' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.get('email')).toBe('ana@example.test');
    expect(calls[0]?.get('password')).toBe('hunter22');
  });

  it("shows the server's field errors on the right field", async () => {
    const user = userEvent.setup();
    const action: FormAction = () =>
      Promise.resolve({ fields: { email: ['Server says no.'] } });
    render(<SignUpForm action={action} />);

    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    const serverError = await screen.findByText('Server says no.');
    expect(serverError.getAttribute('id')).toBe('email-error');
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });
});

describe('LogInForm', () => {
  it('moves focus to the summary when the server answers with a message', async () => {
    const user = userEvent.setup();
    const action: FormAction = () =>
      Promise.resolve({ message: 'Nope, try again.' });
    render(<LogInForm action={action} next={null} />);

    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    const summary = await screen.findByText('Nope, try again.');
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
  });

  it('re-announces and re-focuses the same message on a second failure', async () => {
    // The same wrong password twice gives the same text; an alert whose text
    // does not change is not announced again (code review of #54).
    const user = userEvent.setup();
    const action: FormAction = () =>
      Promise.resolve({ message: 'Nope, try again.' });
    render(<LogInForm action={action} next={null} />);
    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'x');

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const first = await screen.findByText('Nope, try again.');
    await user.click(screen.getByLabelText('Password')); // focus moves away
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      const second = screen.getByText('Nope, try again.');
      expect(second).not.toBe(first); // a fresh alert element: announced anew
      expect(document.activeElement).toBe(second);
    });
  });

  it('keeps the typed values when the server answers with an error', async () => {
    const user = userEvent.setup();
    const action: FormAction = () => Promise.resolve({ message: 'Nope.' });
    render(<LogInForm action={action} next={null} />);
    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByText('Nope.');
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe(
      'ana@example.test',
    );
  });

  it('carries next as a hidden field, and only when there is one', () => {
    const { container, rerender } = render(
      <LogInForm action={pendingAction().action} next="/goals" />,
    );
    expect(
      container.querySelector<HTMLInputElement>('input[name="next"]')?.value,
    ).toBe('/goals');
    rerender(<LogInForm action={pendingAction().action} next={null} />);
    expect(container.querySelector('input[name="next"]')).toBeNull();
  });

  it('uses the autocomplete tokens password managers expect', () => {
    render(<LogInForm action={pendingAction().action} next={null} />);
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe(
      'username',
    );
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe(
      'current-password',
    );
  });
});

describe('ResetRequestForm (M1-F03)', () => {
  it('replaces the form with the one uniform confirmation once sent', async () => {
    const user = userEvent.setup();
    const action: FormAction = () => Promise.resolve({ done: true });
    render(<ResetRequestForm action={action} />);

    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.click(
      screen.getByRole('button', { name: 'Send me a reset link' }),
    );

    expect((await screen.findByRole('status')).textContent).toBe(
      RESET_REQUESTED,
    );
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});

describe('NewPasswordForm (M1-F03)', () => {
  it('flags a mismatched confirmation on that field, without sending', async () => {
    const user = userEvent.setup();
    const { action, calls } = pendingAction();
    render(<NewPasswordForm action={action} />);

    await user.type(screen.getByLabelText('New password'), 'brand-new-pass-1');
    await user.type(screen.getByLabelText('Type it again'), 'brand-new-pass-2');
    await user.click(
      screen.getByRole('button', { name: 'Save my new password' }),
    );

    expect(calls).toHaveLength(0);
    expect(
      document.getElementById('confirmPassword-error')?.textContent,
    ).toMatch(/don't match/);
  });

  it('marks both fields as new passwords for password managers', () => {
    render(<NewPasswordForm action={pendingAction().action} />);
    for (const label of ['New password', 'Type it again']) {
      expect(screen.getByLabelText(label).getAttribute('autocomplete')).toBe(
        'new-password',
      );
    }
  });
});
