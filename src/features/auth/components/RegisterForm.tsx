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
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  BrushOutlined as CanvasIcon,
  Google as GoogleIcon,
  GitHub as GitHubIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters'),
});

type RegisterFormData = z.infer<typeof registerSchema>;

const steps = ['Your Info', 'Security', 'Done'];

export function RegisterForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const password = watch('password', '');
  const email = watch('email', '');
  const name = watch('name', '');

  // Update active step based on field completion
  React.useEffect(() => {
    if (name && email) {
      setActiveStep(1);
    } else {
      setActiveStep(0);
    }
  }, [name, email]);

  const onSubmit = async (data: RegisterFormData) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.type && result.title) {
          if (result.errors && Array.isArray(result.errors)) {
            const errorMessages = result.errors
              .map((err: { message: string }) => err.message)
              .join('. ');
            setError(errorMessages);
          } else {
            setError(result.detail || result.title);
          }
        } else {
          setError('Registration failed. Please try again.');
        }
        return;
      }

      setActiveStep(2);
      setTimeout(() => {
        router.push('/auth/login?registered=true');
      }, 1500);
    } catch (err) {
      console.error('Registration error:', err);
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
          background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 50%, #a8edea 100%)',
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
            left: -50,
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
            right: '10%',
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
            <CanvasIcon sx={{ fontSize: 50, color: '#1e293b' }} />
          </Box>
          <Typography variant="h3" fontWeight={700} gutterBottom sx={{ color: '#1e293b' }}>
            Start Your Journey
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.8, lineHeight: 1.7, color: '#1e293b' }}>
            Create your free account and unlock unlimited creative possibilities.
          </Typography>
        </Box>
      </Box>

      {/* Right side - Register Form */}
      <Box
        sx={{
          flex: { xs: 1, md: '0 0 520px' },
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: { xs: 3, sm: 6 },
          overflowY: 'auto',
        }}
      >
        <Container maxWidth="sm">
          <Box sx={{ animation: 'fadeIn 0.6s ease-out' }}>
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
                  background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CanvasIcon sx={{ fontSize: 30, color: 'white' }} />
              </Box>
            </Box>

            <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
              Create Account
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Sign up to start using CanvasCollect
            </Typography>

            {/* Progress Stepper */}
            <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
              {steps.map((label, index) => (
                <Step key={label}>
                  <StepLabel
                    StepIconComponent={() => (
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor:
                            activeStep >= index
                              ? 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)'
                              : 'action.disabled',
                          background:
                            activeStep >= index
                              ? 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)'
                              : undefined,
                          color: activeStep >= index ? 'white' : 'text.disabled',
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        {index === 0 && <PersonIcon sx={{ fontSize: 18 }} />}
                        {index === 1 && <LockIcon sx={{ fontSize: 18 }} />}
                        {index === 2 && '✓'}
                      </Box>
                    )}
                  >
                    <Typography
                      variant="caption"
                      color={activeStep >= index ? 'text.primary' : 'text.secondary'}
                      fontWeight={activeStep >= index ? 600 : 400}
                    >
                      {label}
                    </Typography>
                  </StepLabel>
                </Step>
              ))}
            </Stepper>

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
                {...register('name')}
                label="Full Name"
                fullWidth
                margin="normal"
                error={!!errors.name}
                helperText={errors.name?.message}
                disabled={isLoading}
                autoFocus
                sx={{ mb: 2 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonIcon color="action" />
                    </InputAdornment>
                  ),
                }}
              />

              <TextField
                {...register('email')}
                label="Email Address"
                type="email"
                fullWidth
                margin="normal"
                error={!!errors.email}
                helperText={errors.email?.message}
                disabled={isLoading}
                autoComplete="email"
                sx={{ mb: 2 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailIcon color="action" />
                    </InputAdornment>
                  ),
                }}
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
                autoComplete="new-password"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockIcon color="action" />
                    </InputAdornment>
                  ),
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

              <PasswordStrengthIndicator password={password} userInputs={[email, name]} />

              <Button
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={isLoading}
                sx={{
                  mt: 3,
                  py: 1.75,
                  fontSize: '1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                  boxShadow: '0 8px 30px rgba(17, 153, 142, 0.3)',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #38ef7d 0%, #11998e 100%)',
                    boxShadow: '0 12px 40px rgba(17, 153, 142, 0.4)',
                  },
                }}
              >
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </Button>

              <Divider sx={{ my: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  or sign up with
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
                      borderColor: 'secondary.main',
                      bgcolor: (theme) => alpha(theme.palette.secondary.main, 0.05),
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
                      borderColor: 'secondary.main',
                      bgcolor: (theme) => alpha(theme.palette.secondary.main, 0.05),
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
                Already have an account?{' '}
                <Link
                  href="/auth/login"
                  sx={{
                    color: 'secondary.main',
                    textDecoration: 'none',
                    fontWeight: 600,
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                >
                  Sign in
                </Link>
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
