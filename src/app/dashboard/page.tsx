import { redirect } from 'next/navigation';
import { Box, Container, Typography, Avatar, alpha } from '@mui/material';
import { auth } from '@/lib/auth';
import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DashboardContent } from '@/features/dashboard/components/DashboardContent';

export const metadata = {
  title: 'Dashboard | CanvasCollect',
  description: 'Your CanvasCollect dashboard',
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  const getInitials = (name?: string | null, email?: string | null) => {
    if (name) return name.charAt(0).toUpperCase();
    if (email) return email.charAt(0).toUpperCase();
    return 'U';
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header with gradient */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          py: 4,
          mb: 4,
          position: 'relative',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.03\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Avatar
                sx={{
                  width: 56,
                  height: 56,
                  fontSize: 24,
                  fontWeight: 700,
                  bgcolor: 'rgba(255,255,255,0.2)',
                  backdropFilter: 'blur(10px)',
                  border: '2px solid rgba(255,255,255,0.3)',
                }}
                src={session.user.image || undefined}
              >
                {getInitials(session.user.name, session.user.email)}
              </Avatar>
              <Box>
                <Typography
                  variant="h4"
                  component="h1"
                  sx={{
                    fontWeight: 700,
                    color: 'white',
                    textShadow: '0 2px 10px rgba(0,0,0,0.1)',
                  }}
                >
                  Welcome back!
                </Typography>
                <Typography
                  variant="body1"
                  sx={{
                    color: 'rgba(255,255,255,0.9)',
                  }}
                >
                  {session.user.name || session.user.email}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <ThemeToggle
                sx={{
                  color: 'white',
                  bgcolor: 'rgba(255,255,255,0.1)',
                  '&:hover': {
                    bgcolor: 'rgba(255,255,255,0.2)',
                  },
                }}
              />
              <LogoutButton
                sx={{
                  color: 'white',
                  borderColor: 'rgba(255,255,255,0.3)',
                  '&:hover': {
                    borderColor: 'white',
                    bgcolor: 'rgba(255,255,255,0.1)',
                  },
                }}
              />
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ pb: 4 }}>
        <DashboardContent />
      </Container>
    </Box>
  );
}
