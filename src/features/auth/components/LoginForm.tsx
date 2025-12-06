'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  Link,
  IconButton,
  InputAdornment,
  Container,
  Divider,
  alpha,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  BrushOutlined as CanvasIcon,
  Google as GoogleIcon,
  GitHub as GitHubIcon,
} from '@mui/icons-material';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const registered = searchParams.get('registered');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid email or password');
        return;
      }

      if (result?.ok) {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left side - Gradient Background with Branding */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flex: 1,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
          position: 'relative',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          p: 6,
          color: 'white',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
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

        <Box sx={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 400 }}>
          <Box
            sx={{
              width: 100,
              height: 100,
              borderRadius: 4,
              bgcolor: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 4,
              animation: 'float 4s ease-in-out infinite',
            }}
          >
            <CanvasIcon sx={{ fontSize: 50 }} />
          </Box>
          <Typography variant="h3" fontWeight={700} gutterBottom>
            Welcome Back
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.9, lineHeight: 1.7 }}>
            Continue your creative journey. Your canvases are waiting for you.
          </Typography>
        </Box>
      </Box>

      {/* Right side - Login Form */}
      <Box
        sx={{
          flex: { xs: 1, md: '0 0 500px' },
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: { xs: 3, sm: 6 },
        }}
      >
        <Container maxWidth="sm">
          <Box
            sx={{
              animation: 'fadeIn 0.6s ease-out',
            }}
          >
            {/* Mobile logo */}
            <Box
              sx={{
                display: { xs: 'flex', md: 'none' },
                justifyContent: 'center',
                mb: 4,
              }}
            >
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 3,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CanvasIcon sx={{ fontSize: 30, color: 'white' }} />
              </Box>
            </Box>

            <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
              Sign In
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              Welcome back! Please enter your details.
            </Typography>

            {registered && (
              <Alert
                severity="success"
                sx={{
                  mb: 3,
                  borderRadius: 2,
                  animation: 'fadeIn 0.4s ease-out',
                }}
              >
                Account created successfully! Please sign in.
              </Alert>
            )}

            {error && (
              <Alert
                severity="error"
                sx={{
                  mb: 3,
                  borderRadius: 2,
                  animation: 'fadeIn 0.4s ease-out',
                }}
              >
                {error}
              </Alert>
            )}

            <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
              <TextField
                {...register('email')}
                label="Email"
                type="email"
                fullWidth
                margin="normal"
                error={!!errors.email}
                helperText={errors.email?.message}
                disabled={isLoading}
                autoComplete="email"
                autoFocus
                sx={{ mb: 2 }}
              />

              <TextField
                {...register('password')}
                label="Password"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                margin="normal"
                error={!!errors.password}
                helperText={errors.password?.message}
                disabled={isLoading}
                autoComplete="current-password"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        disabled={isLoading}
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, mb: 2 }}>
                <Link
                  href="/auth/forgot-password"
                  variant="body2"
                  sx={{
                    color: 'primary.main',
                    textDecoration: 'none',
                    fontWeight: 500,
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                >
                  Forgot password?
                </Link>
              </Box>

              <Button
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={isLoading}
                sx={{
                  py: 1.75,
                  fontSize: '1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  boxShadow: '0 8px 30px rgba(102, 126, 234, 0.3)',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)',
                    boxShadow: '0 12px 40px rgba(102, 126, 234, 0.4)',
                  },
                }}
              >
                {isLoading ? 'Signing In...' : 'Sign In'}
              </Button>

              <Divider sx={{ my: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  or continue with
                </Typography>
              </Divider>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                  variant="outlined"
                  fullWidth
                  sx={{
                    py: 1.5,
                    color: 'text.primary',
                    borderColor: 'divider',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05),
                    },
                  }}
                  disabled
                >
                  <GoogleIcon sx={{ mr: 1, fontSize: 20 }} />
                  Google
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  sx={{
                    py: 1.5,
                    color: 'text.primary',
                    borderColor: 'divider',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05),
                    },
                  }}
                  disabled
                >
                  <GitHubIcon sx={{ mr: 1, fontSize: 20 }} />
                  GitHub
                </Button>
              </Box>

              <Typography
                variant="body2"
                align="center"
                color="text.secondary"
                sx={{ mt: 4 }}
              >
                Don&apos;t have an account?{' '}
                <Link
                  href="/auth/register"
                  sx={{
                    color: 'primary.main',
                    textDecoration: 'none',
                    fontWeight: 600,
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                >
                  Create one
                </Link>
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
