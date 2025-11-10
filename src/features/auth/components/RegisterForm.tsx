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
  Paper,
  IconButton,
  InputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters'),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
        // Handle RFC 7807 problem response
        if (result.type && result.title) {
          if (result.errors && Array.isArray(result.errors)) {
            // Validation errors
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

      // Registration successful - redirect to login
      router.push('/auth/login?registered=true');
    } catch (err) {
      console.error('Registration error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Paper elevation={3} sx={{ p: 4, maxWidth: 500, mx: 'auto', mt: 8 }}>
      <Typography variant="h4" component="h1" gutterBottom align="center">
        Create Account
      </Typography>

      <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
        Sign up to start using CanvasCollect
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField
          {...register('name')}
          label="Name"
          fullWidth
          margin="normal"
          error={!!errors.name}
          helperText={errors.name?.message}
          disabled={isLoading}
          autoFocus
        />

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
          sx={{ mt: 3, mb: 2 }}
        >
          {isLoading ? 'Creating Account...' : 'Create Account'}
        </Button>

        <Typography variant="body2" align="center" color="text.secondary">
          Already have an account?{' '}
          <Link href="/auth/login" underline="hover">
            Sign in
          </Link>
        </Typography>
      </Box>
    </Paper>
  );
}
