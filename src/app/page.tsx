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
  alpha,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Lock as SecurityIcon,
  Speed as PerformanceIcon,
  Devices as DevicesIcon,
  BrushOutlined as CanvasIcon,
  BookmarkBorder as BookmarkIcon,
  Groups as CollaborationIcon,
  AutoAwesome as AIIcon,
} from '@mui/icons-material';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', overflow: 'hidden' }}>
      {/* Hero Section with Animated Background */}
      <Box
        sx={{
          position: 'relative',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
          color: 'white',
          py: { xs: 10, md: 16 },
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
            opacity: 0.5,
          },
        }}
      >
        {/* Floating decorative elements */}
        <Box
          sx={{
            position: 'absolute',
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%)',
            top: -100,
            right: -50,
            animation: 'float 6s ease-in-out infinite',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)',
            bottom: -50,
            left: '10%',
            animation: 'float 8s ease-in-out infinite',
            animationDelay: '1s',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            width: 150,
            height: 150,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)',
            top: '30%',
            left: '60%',
            animation: 'float 7s ease-in-out infinite',
            animationDelay: '2s',
          }}
        />

        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Grid container spacing={6} alignItems="center">
            <Grid item xs={12} md={6}>
              <Box sx={{ animation: 'fadeIn 0.8s ease-out' }}>
                <Typography
                  variant="h1"
                  component="h1"
                  sx={{
                    fontWeight: 800,
                    fontSize: { xs: '2.5rem', sm: '3rem', md: '3.75rem' },
                    lineHeight: 1.1,
                    mb: 3,
                    textShadow: '0 2px 40px rgba(0,0,0,0.2)',
                  }}
                >
                  Organize Your Ideas on an{' '}
                  <Box
                    component="span"
                    sx={{
                      background: 'linear-gradient(90deg, #fff 0%, #a8edea 100%)',
                      backgroundClip: 'text',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    Infinite Canvas
                  </Box>
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    opacity: 0.95,
                    mb: 4,
                    fontWeight: 400,
                    lineHeight: 1.6,
                    maxWidth: 500,
                  }}
                >
                  A beautiful, secure, and blazing-fast note-taking app designed for modern teams and creative minds.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <Button
                    component={Link}
                    href="/auth/register"
                    variant="contained"
                    size="large"
                    sx={{
                      bgcolor: 'white',
                      color: '#667eea',
                      px: 4,
                      py: 1.75,
                      fontSize: '1.1rem',
                      fontWeight: 700,
                      borderRadius: 3,
                      boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                      '&:hover': {
                        bgcolor: 'white',
                        transform: 'translateY(-3px)',
                        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
                      },
                      transition: 'all 0.3s ease',
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
                      borderColor: 'rgba(255,255,255,0.5)',
                      color: 'white',
                      px: 4,
                      py: 1.75,
                      fontSize: '1.1rem',
                      fontWeight: 600,
                      borderRadius: 3,
                      backdropFilter: 'blur(10px)',
                      background: 'rgba(255,255,255,0.1)',
                      '&:hover': {
                        borderColor: 'white',
                        bgcolor: 'rgba(255,255,255,0.2)',
                        transform: 'translateY(-2px)',
                      },
                      transition: 'all 0.3s ease',
                    }}
                  >
                    Sign In
                  </Button>
                </Stack>
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box
                sx={{
                  animation: 'fadeIn 1s ease-out 0.3s both',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <Box
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.15)',
                    backdropFilter: 'blur(20px)',
                    borderRadius: 4,
                    p: 5,
                    textAlign: 'center',
                    border: '1px solid rgba(255,255,255,0.2)',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                    maxWidth: 400,
                    width: '100%',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      gap: 2,
                      mb: 3,
                    }}
                  >
                    <Box
                      sx={{
                        width: 80,
                        height: 80,
                        borderRadius: 3,
                        bgcolor: 'rgba(255,255,255,0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'float 4s ease-in-out infinite',
                      }}
                    >
                      <CanvasIcon sx={{ fontSize: 40 }} />
                    </Box>
                    <Box
                      sx={{
                        width: 80,
                        height: 80,
                        borderRadius: 3,
                        bgcolor: 'rgba(255,255,255,0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'float 4s ease-in-out infinite',
                        animationDelay: '0.5s',
                      }}
                    >
                      <BookmarkIcon sx={{ fontSize: 40 }} />
                    </Box>
                  </Box>
                  <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
                    Infinite Canvas
                  </Typography>
                  <Typography variant="body1" sx={{ opacity: 0.9 }}>
                    Sticky Notes • Bookmarks • Images • Rich Text
                  </Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Features Section */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }}>
        <Box sx={{ textAlign: 'center', mb: 8 }}>
          <Typography
            variant="h2"
            sx={{
              fontWeight: 700,
              mb: 2,
              background: (theme) =>
                theme.palette.mode === 'light'
                  ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                  : 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Everything You Need
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
            Powerful features to capture, organize, and collaborate on your ideas
          </Typography>
        </Box>

        <Grid container spacing={4}>
          {[
            {
              icon: DashboardIcon,
              title: 'Multi-Canvas',
              description: 'Create unlimited canvases to organize different projects, ideas, and workflows.',
              color: '#667eea',
            },
            {
              icon: SecurityIcon,
              title: 'Security First',
              description: 'Enterprise-grade security with Argon2 encryption, rate limiting, and comprehensive protection.',
              color: '#4caf50',
            },
            {
              icon: PerformanceIcon,
              title: 'Lightning Fast',
              description: 'Optimized performance with instant autosave and efficient state management.',
              color: '#ff9800',
            },
            {
              icon: CanvasIcon,
              title: 'Infinite Canvas',
              description: 'Pan, zoom, and arrange your notes freely on an unlimited workspace.',
              color: '#2196f3',
            },
            {
              icon: CollaborationIcon,
              title: 'Real-time Collaboration',
              description: 'Work together with your team in real-time with presence and live cursors.',
              color: '#9c27b0',
            },
            {
              icon: DevicesIcon,
              title: 'Export Anywhere',
              description: 'Export your canvases as PNG, PDF, or JSON for sharing and presentations.',
              color: '#f44336',
            },
          ].map((feature, index) => (
            <Grid item xs={12} sm={6} md={4} key={feature.title}>
              <Card
                sx={{
                  height: '100%',
                  animation: `fadeIn 0.5s ease-out ${index * 0.1}s both`,
                  cursor: 'default',
                  '&:hover': {
                    '& .feature-icon': {
                      transform: 'scale(1.1) rotate(5deg)',
                    },
                  },
                }}
              >
                <CardContent sx={{ p: 4, textAlign: 'center' }}>
                  <Box
                    className="feature-icon"
                    sx={{
                      width: 80,
                      height: 80,
                      borderRadius: 3,
                      bgcolor: alpha(feature.color, 0.1),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 3,
                      transition: 'transform 0.3s ease',
                    }}
                  >
                    <feature.icon sx={{ fontSize: 40, color: feature.color }} />
                  </Box>
                  <Typography variant="h5" gutterBottom fontWeight={600}>
                    {feature.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                    {feature.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* CTA Section */}
      <Box
        sx={{
          py: { xs: 8, md: 12 },
          background: (theme) =>
            theme.palette.mode === 'light'
              ? 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
              : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Container maxWidth="md">
          <Box
            sx={{
              textAlign: 'center',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Typography
              variant="h2"
              gutterBottom
              fontWeight={700}
              sx={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Ready to Get Organized?
            </Typography>
            <Typography
              variant="h6"
              color="text.secondary"
              sx={{ mb: 4, maxWidth: 500, mx: 'auto' }}
            >
              Join thousands of users and experience a better way to capture and organize your ideas.
            </Typography>
            <Button
              component={Link}
              href="/auth/register"
              variant="contained"
              size="large"
              sx={{
                px: 6,
                py: 2,
                fontSize: '1.2rem',
                borderRadius: 3,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                boxShadow: '0 10px 40px rgba(102, 126, 234, 0.4)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)',
                  transform: 'translateY(-3px)',
                  boxShadow: '0 15px 50px rgba(102, 126, 234, 0.5)',
                },
                transition: 'all 0.3s ease',
              }}
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
      <Box
        sx={{
          bgcolor: 'background.paper',
          py: 4,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={4} alignItems="center">
            <Grid item xs={12} md={6}>
              <Typography
                variant="h6"
                gutterBottom
                fontWeight={700}
                sx={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                CanvasCollect
              </Typography>
              <Typography variant="body2" color="text.secondary">
                A modern, secure, and fast note-taking application built with Next.js and TypeScript.
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ textAlign: { xs: 'left', md: 'right' } }}
              >
                © 2025 CanvasCollect. Built with ❤️ for productivity.
              </Typography>
            </Grid>
          </Grid>
        </Container>
      </Box>
    </Box>
  );
}
