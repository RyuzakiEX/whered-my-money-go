// The app's navigation — spec §25, in its order. One list, rendered by both the
// desktop sidebar and the mobile drawer, so the two cannot drift.

import {
  ArrowLeftRightIcon,
  ChartColumnIcon,
  ChartLineIcon,
  FlaskConicalIcon,
  LayoutDashboardIcon,
  PiggyBankIcon,
  SettingsIcon,
  TargetIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
  /** Shipped as a placeholder; the feature is V2 (spec §18). */
  v2?: true;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', Icon: LayoutDashboardIcon },
  { label: 'Transactions', href: '/transactions', Icon: ArrowLeftRightIcon },
  { label: 'Budget', href: '/budget', Icon: PiggyBankIcon },
  { label: 'Goals', href: '/goals', Icon: TargetIcon },
  { label: 'Timeline', href: '/timeline', Icon: ChartLineIcon },
  { label: 'Accounts', href: '/accounts', Icon: WalletIcon },
  { label: 'Reports', href: '/reports', Icon: ChartColumnIcon },
  { label: 'What If?', href: '/what-if', Icon: FlaskConicalIcon, v2: true },
  { label: 'Settings', href: '/settings', Icon: SettingsIcon },
];
