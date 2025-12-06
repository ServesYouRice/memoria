import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SettingsContent } from './SettingsContent';

export const metadata = {
    title: 'Settings | CanvasCollect',
    description: 'Manage your account settings',
};

export default async function SettingsPage() {
    const session = await auth();

    if (!session?.user) {
        redirect('/auth/login');
    }

    return <SettingsContent user={session.user} />;
}
