import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { ApiKeysContent } from './ApiKeysContent';

export const metadata = {
  title: 'API Keys',
  description: 'Manage API keys for external access and extensions',
};

export default async function ApiKeysPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <AppShell maxWidth="md">
      <ApiKeysContent />
    </AppShell>
  );
}
