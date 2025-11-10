import { redirect } from 'next/navigation';
import { Box, Container, Typography, Paper } from '@mui/material';
import { auth } from '@/lib/auth';
import { LogoutButton } from '@/features/auth/components/LogoutButton';

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
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h3" component="h1">
          Dashboard
        </Typography>
        <LogoutButton />
      </Box>

      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          Welcome, {session.user.name || session.user.email}!
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Your CanvasCollect dashboard is ready. Canvas functionality will be implemented in Slice
          3.
        </Typography>
      </Paper>
    </Container>
  );
}
