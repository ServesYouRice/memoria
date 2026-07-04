import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export const metadata = {
  title: 'Profile',
  description: 'Manage your profile',
};

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  redirect('/settings');
}
