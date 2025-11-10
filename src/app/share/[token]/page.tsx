/**
 * Public Canvas Share Page
 * View a publicly shared canvas without authentication
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Box, CircularProgress, Alert, Typography, Button, AppBar, Toolbar } from '@mui/material';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface SharePageProps {
  params: {
    token: string;
  };
}

export default function SharePage({ params }: SharePageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<any>(null);

  useEffect(() => {
    const fetchCanvas = async () => {
      try {
        const response = await fetch(`/api/v1/share/${params.token}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError('Canvas not found or link has expired');
          } else if (response.status === 403) {
            setError('This canvas is no longer publicly shared');
          } else {
            setError('Failed to load canvas');
          }
          setLoading(false);
          return;
        }

        const data = await response.json();
        setCanvas(data);
      } catch (err) {
        setError('Failed to load canvas');
      } finally {
        setLoading(false);
      }
    };

    fetchCanvas();
  }, [params.token]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 4 }}>
        <Alert severity="error" sx={{ mb: 2, maxWidth: 500 }}>
          {error}
        </Alert>
        <Button component={Link} href="/" variant="contained">
          Go to Home
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {canvas?.name || 'Shared Canvas'} (Read Only)
          </Typography>
          <Button component={Link} href="/auth/login" variant="outlined" sx={{ mr: 1 }}>
            Sign In
          </Button>
          <Button component={Link} href="/auth/register" variant="contained">
            Sign Up
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4 }}>
        <Typography variant="h6" color="text.secondary">
          Canvas viewer will be implemented here (read-only view of canvas items)
        </Typography>
      </Box>
    </Box>
  );
}
