import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { SharedCanvasesContent } from './SharedCanvasesContent';

export const metadata = {
  title: 'Shared with me',
  description: 'Canvases other people shared with you',
};

export default async function SharedPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <AppShell>
      <SharedCanvasesContent />
    </AppShell>
  );
}
