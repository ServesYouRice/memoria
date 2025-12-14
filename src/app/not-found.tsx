import Link from 'next/link';
import { Box, Button, Container, Typography } from '@mui/material';
import { Home as HomeIcon, ErrorOutline as NotFoundIcon } from '@mui/icons-material';

export default function NotFound() {
    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
                    background: 'radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)',
                    top: -150,
                    right: -100,
                    animation: 'float 6s ease-in-out infinite',
                }}
            />
            <Box
                sx={{
                    position: 'absolute',
                    width: 250,
                    height: 250,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)',
                    bottom: -80,
                    left: '5%',
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
                    {/* Animated Icon */}
                    <Box
                        sx={{
                            width: 150,
                            height: 150,
                            borderRadius: '50%',
                            bgcolor: 'rgba(255,255,255,0.15)',
                            backdropFilter: 'blur(20px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mx: 'auto',
                            mb: 4,
                            animation: 'float 3s ease-in-out infinite',
                            border: '2px solid rgba(255,255,255,0.2)',
                        }}
                    >
                        <NotFoundIcon sx={{ fontSize: 70, color: 'white' }} />
                    </Box>

                    {/* 404 Text */}
                    <Typography
                        variant="h1"
                        sx={{
                            fontSize: { xs: '6rem', md: '8rem' },
                            fontWeight: 800,
                            color: 'white',
                            textShadow: '0 4px 20px rgba(0,0,0,0.2)',
                            mb: 2,
                            lineHeight: 1,
                        }}
                    >
                        404
                    </Typography>

                    <Typography
                        variant="h4"
                        sx={{
                            fontWeight: 600,
                            color: 'white',
                            mb: 2,
                        }}
                    >
                        Page Not Found
                    </Typography>

                    <Typography
                        variant="body1"
                        sx={{
                            color: 'rgba(255,255,255,0.85)',
                            mb: 4,
                            maxWidth: 400,
                            mx: 'auto',
                            lineHeight: 1.7,
                        }}
                    >
                        Oops! The canvas you&apos;re looking for seems to have wandered off into the infinite
                        void. Let&apos;s get you back on track.
                    </Typography>

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Button
                            component={Link}
                            href="/"
                            variant="contained"
                            size="large"
                            startIcon={<HomeIcon />}
                            sx={{
                                bgcolor: 'white',
                                color: '#667eea',
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
                            Go Home
                        </Button>
                        <Button
                            component={Link}
                            href="/dashboard"
                            variant="outlined"
                            size="large"
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
                            Go to Dashboard
                        </Button>
                    </Box>
                </Box>
            </Container>
        </Box>
    );
}
