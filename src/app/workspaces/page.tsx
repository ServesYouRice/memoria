import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import WorkspacesPageClient from './WorkspacesPageClient';

export const metadata = {
  title: 'Workspaces | CanvasCollect',
  description: 'Organize canvases into workspaces',
};

export default async function WorkspacesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return <WorkspacesPageClient />;
}
