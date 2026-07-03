import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { TemplatesContent } from './TemplatesContent';

export const metadata = {
  title: 'Templates',
  description: 'Start with a pre-designed canvas',
};

export default async function TemplatesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <AppShell>
      <TemplatesContent />
    </AppShell>
  );
}
