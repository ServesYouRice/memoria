'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box,
  Button,
  Container,
  Typography,
  Alert,
  Paper,
  CircularProgress,
} from '@mui/material';
import { CheckCircle } from '@mui/icons-material';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid verification link');
      setLoading(false);
      return;
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch('/api/v1/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Verification failed');
        }

        setSuccess(true);
        // Redirect to dashboard after 3 seconds
        setTimeout(() => {
          router.push('/dashboard');
        }, 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Verification failed');
      } finally {
        setLoading(false);
      }
    };

    verifyEmail();
  }, [token, router]);

  if (loading) {
    return (
      <Container maxWidth="sm">
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Paper elevation={3} sx={{ p: 4, width: '100%', textAlign: 'center' }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6">Verifying your email...</Typography>
          </Paper>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Paper elevation={3} sx={{ p: 4, width: '100%', textAlign: 'center' }}>
          {success ? (
            <>
              <CheckCircle sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
              <Typography variant="h4" gutterBottom fontWeight={600}>
                Email Verified!
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                Your email has been successfully verified. Redirecting to dashboard...
              </Typography>
              <Button component={Link} href="/dashboard" variant="contained" size="large">
                Go to Dashboard
              </Button>
            </>
          ) : (
            <>
              <Typography variant="h4" gutterBottom fontWeight={600} color="error">
                Verification Failed
              </Typography>
              <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
                {error || 'An error occurred during verification'}
              </Alert>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The verification link may have expired or is invalid.
              </Typography>
              <Button component={Link} href="/dashboard" variant="contained" size="large">
                Go to Dashboard
              </Button>
            </>
          )}
        </Paper>
      </Box>
    </Container>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <Container maxWidth="sm">
          <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        </Container>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
