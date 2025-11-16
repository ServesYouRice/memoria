import { redirect } from 'next/navigation';
import { Box, Container, Typography } from '@mui/material';
import { auth } from '@/lib/auth';
import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { DashboardContent } from '@/features/dashboard/components/DashboardContent';
import { ThemeToggle } from '@/components/ThemeToggle';

export const metadata = {
  title: 'Dashboard | CanvasCollect',
  description: 'Your CanvasCollect dashboard',
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h3" component="h1" gutterBottom>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Welcome back, {session.user.name || session.user.email}!
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ThemeToggle />
          <LogoutButton />
        </Box>
      </Box>

      <DashboardContent />
    </Container>
  );
}
