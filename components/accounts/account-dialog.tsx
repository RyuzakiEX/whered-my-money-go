'use client';

// The account create / edit dialog (M2-F02): AccountForm inside a Radix
// dialog, which traps focus, closes on Escape, and returns focus to the
// trigger. The form mounts only while open, so every opening starts from the
// initial values. Under 640px the same dialog is a bottom sheet: one
// component and one focus trap, laid out by CSS rather than swapped by a
// media-query hook that would render differently on the server.

import { PencilIcon, PlusIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { SupportedCurrency } from '@/lib/core/money/currency';

import {
  AccountForm,
  EMPTY_ACCOUNT,
  type AccountFormValues,
  type AccountSaveResult,
} from './account-form';

const BOTTOM_SHEET =
  'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:max-h-[90dvh] max-sm:overflow-y-auto sm:max-w-md';

type DialogProps = {
  currency: SupportedCurrency;
  saveAction: (values: AccountFormValues) => Promise<AccountSaveResult>;
  /** Classes for the trigger button. */
  triggerClassName?: string;
} & (
  | { mode: 'create' }
  | {
      mode: 'edit';
      accountId: string;
      initial: AccountFormValues;
    }
);

/**
 * Where focus goes when the dialog closes: its trigger, or — when saving the
 * first account swapped the empty state for the list and took that trigger
 * with it — the page's live "Add account". Only create has a fallback: an
 * edit trigger is per account, and the first one found could be another's.
 */
function restoreFocus(trigger: HTMLElement | null, mode: 'create' | 'edit') {
  requestAnimationFrame(() => {
    if (trigger?.isConnected) {
      trigger.focus();
      return;
    }
    const active = document.activeElement;
    if (mode !== 'create' || (active && active !== document.body)) return;
    document
      .querySelector<HTMLElement>('[data-account-trigger="create"]')
      ?.focus();
  });
}

export function AccountDialog(props: DialogProps) {
  const [open, setOpen] = useState(false);
  const { mode, currency, saveAction, triggerClassName } = props;
  const editing = mode === 'edit';
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A save in flight cannot be abandoned: closing would hide its outcome,
  // and the account may already exist.
  const pendingRef = useRef(false);
  const onPendingChange = useCallback((pending: boolean) => {
    pendingRef.current = pending;
  }, []);

  function onSaved(values: AccountFormValues) {
    setOpen(false);
    toast.success(
      editing
        ? `Saved. ${values.name.trim()} is up to date.`
        : `${values.name.trim()} is in. We'll keep count.`,
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pendingRef.current) return;
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          ref={triggerRef}
          data-account-trigger={mode}
          size="lg"
          variant={editing ? 'outline' : 'default'}
          className={cn('min-h-11', triggerClassName)}
        >
          {editing ? <PencilIcon aria-hidden /> : <PlusIcon aria-hidden />}
          {editing ? 'Edit' : 'Add account'}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={BOTTOM_SHEET}
        // Radix calls this on close AND when the content unmounts with the
        // dialog still open, as when a save's refresh replaces this trigger.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus(triggerRef.current, mode);
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${props.initial.name}` : 'Add an account'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change the details. Its history stays as it is.'
              : 'Anywhere your money lives: a wallet, a bank, an e-wallet.'}
          </DialogDescription>
        </DialogHeader>
        <AccountForm
          mode={mode}
          currency={currency}
          saveAction={saveAction}
          onSaved={onSaved}
          onPendingChange={onPendingChange}
          {...(editing
            ? { accountId: props.accountId, initial: props.initial }
            : { initial: EMPTY_ACCOUNT })}
        />
      </DialogContent>
    </Dialog>
  );
}
