import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminClient } from '@/lib/server/supabase/admin';
import {
  contrast,
  parseHex,
  parseOklch,
  tokensIn,
} from '@/tests/unit/design/color';
import type { Database } from '@/types/database';

import { LOCAL_ANON_KEY, LOCAL_API_URL } from './setup';

/**
 * M3-B02: spec §7's default categories, seeded by the sign-up trigger.
 *
 * Users are created through the Auth admin API, so the trigger fires exactly
 * as it does for a real sign-up. The pgTAP file default_categories_test.sql
 * covers what only the database can show: that the seed shares the sign-up
 * transaction, and that the function is not callable from a session.
 */

const admin = createAdminClient();
const created: string[] = [];

// Spec §7, verbatim. Order is irrelevant; names and types are the contract.
const EXPECTED = [
  ['Food', 'expense'],
  ['Transportation', 'expense'],
  ['Bills', 'expense'],
  ['Shopping', 'expense'],
  ['Entertainment', 'expense'],
  ['Health', 'expense'],
  ['Education', 'expense'],
  ['Subscriptions', 'expense'],
  ['Housing', 'expense'],
  ['Other', 'expense'],
  ['Salary', 'income'],
  ['Freelance', 'income'],
  ['Business', 'income'],
  ['Investment', 'income'],
  ['Gift', 'income'],
  ['Other', 'income'],
] as const;

async function createUser() {
  const email = `m3-categories-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function categoriesOf(userId: string) {
  const { data, error } = await admin
    .from('categories')
    .select('name, type, color, icon, is_default')
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('default categories seeded on sign-up (M3-B02)', () => {
  let user: Awaited<ReturnType<typeof createUser>>;
  let rows: Awaited<ReturnType<typeof categoriesOf>>;

  beforeAll(async () => {
    user = await createUser();
    rows = await categoriesOf(user.id);
  });

  it('creates exactly the 16 spec §7 categories, with their types', () => {
    expect(rows).toHaveLength(16);
    expect(rows.map((r) => [r.name, r.type]).sort()).toEqual(
      EXPECTED.map(([name, type]) => [name, type]).sort(),
    );
  });

  it('marks every seeded category as a default', () => {
    expect(rows.every((r) => r.is_default)).toBe(true);
  });

  it('gives each category its own colour and an icon', () => {
    expect(new Set(rows.map((r) => r.color)).size).toBe(16);
    for (const r of rows) expect(r.icon).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('is idempotent: seeding the same user twice more inserts nothing', async () => {
    for (let i = 0; i < 2; i++) {
      const { error } = await admin.rpc('seed_default_categories', {
        p_user_id: user.id,
      });
      expect(error).toBeNull();
    }
    expect(await categoriesOf(user.id)).toHaveLength(16);
  });

  it('cannot be called from a signed-in session', async () => {
    const client = createClient<Database>(LOCAL_API_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword(user);
    expect(signInError).toBeNull();

    const { error } = await client.rpc('seed_default_categories', {
      p_user_id: user.id,
    });
    expect(error).not.toBeNull();
  });

  it('removes the categories when the auth user is deleted', async () => {
    const other = await createUser();
    expect(await categoriesOf(other.id)).toHaveLength(16);
    await admin.auth.admin.deleteUser(other.id);
    expect(await categoriesOf(other.id)).toHaveLength(0);
  });
});

/**
 * The seeded colours fill chart segments and category chips, so each must be
 * distinguishable from the surface behind it in BOTH themes. WCAG 1.4.11
 * (non-text contrast) is 3:1 — the same bar contrast.test.ts holds the focus
 * ring to. Read from the database, so a palette edit in the migration is
 * caught here.
 */
describe('default category colours meet AA non-text contrast (M3-B02)', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  const surfaces = (['background', 'card'] as const).flatMap((token) =>
    (
      [
        ['light', tokensIn(css, ':root')],
        ['dark', tokensIn(css, '.dark')],
      ] as const
    ).map(([theme, tokens]) => ({
      label: `${theme} ${token}`,
      value: parseOklch(tokens.get(token)!),
    })),
  );

  it('reaches 3:1 against background and card in light and dark', async () => {
    const user = await createUser();
    const rows = await categoriesOf(user.id);
    expect(rows).toHaveLength(16);

    const failures = rows.flatMap((r) =>
      surfaces
        .map((s) => ({
          pair: `${r.type}/${r.name} ${r.color} on ${s.label}`,
          ratio: contrast(parseHex(r.color), s.value),
        }))
        .filter(({ ratio }) => ratio < 3),
    );
    expect(failures).toEqual([]);
  });
});
