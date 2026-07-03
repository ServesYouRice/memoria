import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { SettingsContent } from './SettingsContent';

export const metadata = {
  title: 'Settings',
  description: 'Manage your account settings',
};

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <AppShell maxWidth="md">
      <SettingsContent user={session.user} />
    </AppShell>
  );
}
