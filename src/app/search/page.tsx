import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { SearchContent } from './SearchContent';

export const metadata = {
  title: 'Search',
  description: 'Search across your canvases and items',
};

export default async function SearchPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <AppShell maxWidth="md">
      <Suspense>
        <SearchContent />
      </Suspense>
    </AppShell>
  );
}
