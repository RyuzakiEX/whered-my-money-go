// How each account type is shown: a human label and an icon (M2-F01).
//
// Keyed by the domain union, so a type added to ACCOUNT_TYPES without an entry
// here is a type error rather than a card with no label.

import {
  BanknoteIcon,
  CircleEllipsisIcon,
  CreditCardIcon,
  LandmarkIcon,
  PiggyBankIcon,
  SmartphoneIcon,
  type LucideIcon,
} from 'lucide-react';

import type { AccountType } from '@/lib/core/types';

export const ACCOUNT_TYPE_LABELS: Readonly<Record<AccountType, string>> = {
  cash: 'Cash',
  bank: 'Bank',
  // GCash and Maya are both e-wallets: the provider is the account's name.
  ewallet: 'E-wallet',
  credit_card: 'Credit card',
  savings: 'Savings',
  other: 'Other',
};

export const ACCOUNT_TYPE_ICONS: Readonly<Record<AccountType, LucideIcon>> = {
  cash: BanknoteIcon,
  bank: LandmarkIcon,
  ewallet: SmartphoneIcon,
  credit_card: CreditCardIcon,
  savings: PiggyBankIcon,
  other: CircleEllipsisIcon,
};
