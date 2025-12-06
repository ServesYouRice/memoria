'use client';

import { useEffect } from 'react';
import { Box, Button, Container, Typography } from '@mui/material';
import { Refresh as RefreshIcon, Home as HomeIcon, Warning as ErrorIcon } from '@mui/icons-material';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('Application error:', error);
    }, [error]);

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {/* Floating decorative elements */}
            <Box
                sx={{
                    position: 'absolute',
                    width: 400,
                    height: 400,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)',
                    top: -150,
                    left: -100,
                    animation: 'float 6s ease-in-out infinite',
                }}
            />
            <Box
                sx={{
                    position: 'absolute',
                    width: 200,
                    height: 200,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)',
                    bottom: -50,
                    right: '10%',
                    animation: 'float 8s ease-in-out infinite',
                    animationDelay: '1s',
                }}
            />

            <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
                <Box
                    sx={{
                        textAlign: 'center',
                        animation: 'fadeIn 0.6s ease-out',
                    }}
                >
                    {/* Animated Error Icon */}
                    <Box
                        sx={{
                            width: 140,
                            height: 140,
                            borderRadius: '50%',
                            bgcolor: 'rgba(255,255,255,0.15)',
                            backdropFilter: 'blur(20px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mx: 'auto',
                            mb: 4,
                            animation: 'pulse 2s ease-in-out infinite',
                            border: '2px solid rgba(255,255,255,0.2)',
                        }}
                    >
                        <ErrorIcon sx={{ fontSize: 70, color: 'white' }} />
                    </Box>

                    <Typography
                        variant="h3"
                        sx={{
                            fontWeight: 700,
                            color: 'white',
                            mb: 2,
                            textShadow: '0 2px 10px rgba(0,0,0,0.2)',
                        }}
                    >
                        Something Went Wrong
                    </Typography>

                    <Typography
                        variant="body1"
                        sx={{
                            color: 'rgba(255,255,255,0.9)',
                            mb: 2,
                            maxWidth: 400,
                            mx: 'auto',
                            lineHeight: 1.7,
                        }}
                    >
                        We encountered an unexpected error. Don&apos;t worry, your work has been saved. Please
                        try again or return to the home page.
                    </Typography>

                    {error.digest && (
                        <Typography
                            variant="caption"
                            sx={{
                                display: 'block',
                                color: 'rgba(255,255,255,0.6)',
                                mb: 4,
                                fontFamily: 'monospace',
                            }}
                        >
                            Error ID: {error.digest}
                        </Typography>
                    )}

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Button
                            onClick={reset}
                            variant="contained"
                            size="large"
                            startIcon={<RefreshIcon />}
                            sx={{
                                bgcolor: 'white',
                                color: '#ee5a24',
                                px: 4,
                                py: 1.5,
                                fontWeight: 600,
                                borderRadius: 3,
                                boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                                '&:hover': {
                                    bgcolor: 'white',
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
                                },
                                transition: 'all 0.3s ease',
                            }}
                        >
                            Try Again
                        </Button>
                        <Button
                            href="/"
                            variant="outlined"
                            size="large"
                            startIcon={<HomeIcon />}
                            sx={{
                                borderColor: 'rgba(255,255,255,0.5)',
                                color: 'white',
                                px: 4,
                                py: 1.5,
                                fontWeight: 600,
                                borderRadius: 3,
                                backdropFilter: 'blur(10px)',
                                background: 'rgba(255,255,255,0.1)',
                                '&:hover': {
                                    borderColor: 'white',
                                    bgcolor: 'rgba(255,255,255,0.2)',
                                },
                                transition: 'all 0.3s ease',
                            }}
                        >
                            Go Home
                        </Button>
                    </Box>
                </Box>
            </Container>
        </Box>
    );
}
