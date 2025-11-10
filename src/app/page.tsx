import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import {
  Box,
  Button,
  Container,
  Grid,
  Typography,
  Card,
  CardContent,
  Stack,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Lock as SecurityIcon,
  Speed as PerformanceIcon,
  Devices as DevicesIcon,
  BrushOutlined as CanvasIcon,
  BookmarkBorder as BookmarkIcon,
} from '@mui/icons-material';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero Section */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          py: { xs: 8, md: 12 },
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={4} alignItems="center">
            <Grid item xs={12} md={6}>
              <Typography
                variant="h2"
                component="h1"
                gutterBottom
                sx={{ fontWeight: 700, fontSize: { xs: '2.5rem', md: '3.5rem' } }}
              >
                Organize Your Ideas on an Infinite Canvas
              </Typography>
              <Typography variant="h5" paragraph sx={{ opacity: 0.95, mb: 4 }}>
                CanvasCollect: A secure, fast, and beautiful note-taking app built for modern teams and individuals.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Button
                  component={Link}
                  href="/auth/register"
                  variant="contained"
                  size="large"
                  sx={{
                    bgcolor: 'white',
                    color: 'primary.main',
                    '&:hover': { bgcolor: 'grey.100' },
                    px: 4,
                    py: 1.5,
                  }}
                >
                  Get Started Free
                </Button>
                <Button
                  component={Link}
                  href="/auth/login"
                  variant="outlined"
                  size="large"
                  sx={{
                    borderColor: 'white',
                    color: 'white',
                    '&:hover': { borderColor: 'grey.100', bgcolor: 'rgba(255,255,255,0.1)' },
                    px: 4,
                    py: 1.5,
                  }}
                >
                  Sign In
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box
                sx={{
                  bgcolor: 'rgba(255,255,255,0.1)',
                  borderRadius: 2,
                  p: 4,
                  textAlign: 'center',
                }}
              >
                <CanvasIcon sx={{ fontSize: 120, opacity: 0.9 }} />
                <Typography variant="h6" sx={{ mt: 2 }}>
                  Infinite Canvas • Sticky Notes • Bookmarks
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Features Section */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Typography variant="h3" align="center" gutterBottom sx={{ fontWeight: 600, mb: 6 }}>
          Everything You Need to Organize Better
        </Typography>
        <Grid container spacing={4}>
          <Grid item xs={12} sm={6} md={4}>
            <Card elevation={2} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', p: 4 }}>
                <DashboardIcon sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
                <Typography variant="h5" gutterBottom fontWeight={600}>
                  Multi-Canvas
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Create unlimited canvases to organize different projects, ideas, and workflows
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card elevation={2} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', p: 4 }}>
                <SecurityIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
                <Typography variant="h5" gutterBottom fontWeight={600}>
                  Security First
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  95/100 security score with Argon2 encryption, rate limiting, and comprehensive protection
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card elevation={2} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', p: 4 }}>
                <PerformanceIcon sx={{ fontSize: 60, color: 'warning.main', mb: 2 }} />
                <Typography variant="h5" gutterBottom fontWeight={600}>
                  Lightning Fast
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Optimized performance with debounced autosave and efficient state management
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card elevation={2} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', p: 4 }}>
                <CanvasIcon sx={{ fontSize: 60, color: 'info.main', mb: 2 }} />
                <Typography variant="h5" gutterBottom fontWeight={600}>
                  Infinite Canvas
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Pan, zoom, and arrange your notes freely on an unlimited workspace
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card elevation={2} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', p: 4 }}>
                <BookmarkIcon sx={{ fontSize: 60, color: 'secondary.main', mb: 2 }} />
                <Typography variant="h5" gutterBottom fontWeight={600}>
                  Notes & Bookmarks
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Create sticky notes and save important URLs all in one visual workspace
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card elevation={2} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', p: 4 }}>
                <DevicesIcon sx={{ fontSize: 60, color: 'error.main', mb: 2 }} />
                <Typography variant="h5" gutterBottom fontWeight={600}>
                  Export Anywhere
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Export your canvases as high-quality PNG images for sharing and presentations
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>

      {/* CTA Section */}
      <Box sx={{ bgcolor: 'grey.50', py: 8 }}>
        <Container maxWidth="md">
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h3" gutterBottom fontWeight={600}>
              Ready to Get Organized?
            </Typography>
            <Typography variant="h6" color="text.secondary" paragraph>
              Join CanvasCollect today and experience a better way to capture and organize your ideas.
            </Typography>
            <Button
              component={Link}
              href="/auth/register"
              variant="contained"
              size="large"
              sx={{ mt: 2, px: 6, py: 2, fontSize: '1.1rem' }}
            >
              Start Free Now
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              No credit card required • Free forever
            </Typography>
          </Box>
        </Container>
      </Box>

      {/* Footer */}
      <Box sx={{ bgcolor: 'background.paper', py: 4, borderTop: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                CanvasCollect
              </Typography>
              <Typography variant="body2" color="text.secondary">
                A modern, secure, and fast note-taking application built with Next.js and TypeScript.
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="body2" color="text.secondary" align={{ xs: 'left', md: 'right' }}>
                © 2025 CanvasCollect. Built with security and performance in mind.
              </Typography>
            </Grid>
          </Grid>
        </Container>
      </Box>
    </Box>
  );
}
