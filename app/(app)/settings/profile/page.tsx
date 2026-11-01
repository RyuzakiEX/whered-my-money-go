import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  ProfileForm,
  type ProfileSaveResult,
  type ProfileValues,
} from '@/components/settings/profile-form';
import { updateProfile } from '@/lib/server/actions/profile';
import { getProfile } from '@/lib/server/queries/profile';
import { timeZoneOptions } from '@/lib/validation/timezone';

export const metadata: Metadata = { title: 'Profile settings' };

/** The form's save, adapting updateProfile's envelope into what it renders. */
async function saveProfile(values: ProfileValues): Promise<ProfileSaveResult> {
  'use server';
  const result = await updateProfile(values);
  if (result.ok) return { ok: true, data: result.data };
  switch (result.error.kind) {
    case 'validation':
      return { ok: false, fields: result.error.fields };
    case 'unauthenticated':
      return {
        ok: false,
        message: 'Your session ended. Log in and try again.',
      };
    case 'unexpected':
      return {
        ok: false,
        message: `We couldn't save that. Try again, and if it keeps happening, mention code ${result.error.correlationId}.`,
      };
    default:
      return { ok: false };
  }
}

export default async function ProfileSettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect('/auth/signout');

  // The saved zone first, then common modern names this runtime omits.
  const timezones = timeZoneOptions(profile.timezone);
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-muted-foreground">
          How we greet you, and how your money is shown.
        </p>
      </div>
      <ProfileForm
        initial={{
          displayName: profile.displayName,
          currency: profile.currency,
          timezone: profile.timezone,
        }}
        timezones={timezones}
        saveAction={saveProfile}
      />
    </div>
  );
}
