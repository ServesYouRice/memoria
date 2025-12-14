'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Box,
    Dialog,
    IconButton,
    Typography,
    Fab,
    Chip,
    Paper,
    Slide,
    Alert,
} from '@mui/material';
import {
    CameraAlt as CameraIcon,
    Close as CloseIcon,
    Visibility as VisibilityIcon,
    VisibilityOff as VisibilityOffIcon,
    Fullscreen as FullscreenIcon,
    FullscreenExit as FullscreenExitIcon,
} from '@mui/icons-material';

interface ARCanvasLayerProps {
    open: boolean;
    onClose: () => void;
    items: Array<{
        id: string;
        type: string;
        content: { text?: string; title?: string; url?: string };
        positionX: number;
        positionY: number;
    }>;
}

/**
 * AR Canvas Layer - Experimental Feature
 * Overlays canvas notes on camera feed for "augmented reality" style viewing.
 * Uses WebRTC getUserMedia API for camera access.
 */
export function ARCanvasLayer({ open, onClose, items }: ARCanvasLayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showOverlay, setShowOverlay] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Start camera when dialog opens
    useEffect(() => {
        if (open) {
            startCamera();
        } else {
            stopCamera();
        }

        return () => {
            stopCamera();
        };
    }, [open]);

    const startCamera = async () => {
        try {
            setError(null);
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Prefer back camera on mobile
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
            });
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
        } catch (err) {
            console.error('Camera access error:', err);
            setError(
                'Unable to access camera. Please ensure camera permissions are granted.'
            );
        }
    };

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            setStream(null);
        }
    }, [stream]);

    const toggleFullscreen = async () => {
        if (!containerRef.current) return;

        if (!isFullscreen) {
            try {
                await containerRef.current.requestFullscreen();
                setIsFullscreen(true);
            } catch (err) {
                console.error('Fullscreen error:', err);
            }
        } else {
            try {
                await document.exitFullscreen();
                setIsFullscreen(false);
            } catch (err) {
                console.error('Exit fullscreen error:', err);
            }
        }
    };

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Get truncated preview text for overlay cards
    const getPreviewText = (item: ARCanvasLayerProps['items'][0]) => {
        if (item.content.title) return item.content.title;
        if (item.content.text) return item.content.text.slice(0, 80) + (item.content.text.length > 80 ? '...' : '');
        if (item.content.url) return item.content.url;
        return 'Canvas Item';
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullScreen
            TransitionComponent={Slide}
            TransitionProps={{ direction: 'up' } as any}
        >
            <Box
                ref={containerRef}
                sx={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    bgcolor: 'black',
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        zIndex: 10,
                        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
                        p: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CameraIcon sx={{ color: 'white' }} />
                        <Typography variant="h6" sx={{ color: 'white' }}>
                            AR Canvas Layer
                        </Typography>
                        <Chip
                            label="EXPERIMENTAL"
                            size="small"
                            sx={{
                                bgcolor: 'warning.main',
                                color: 'warning.contrastText',
                                fontWeight: 'bold',
                            }}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <IconButton onClick={toggleFullscreen} sx={{ color: 'white' }}>
                            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                        </IconButton>
                        <IconButton onClick={onClose} sx={{ color: 'white' }}>
                            <CloseIcon />
                        </IconButton>
                    </Box>
                </Box>

                {/* Camera Feed */}
                {error ? (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            p: 4,
                        }}
                    >
                        <Alert severity="error" sx={{ maxWidth: 400 }}>
                            {error}
                        </Alert>
                    </Box>
                ) : (
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />
                )}

                {/* AR Overlay - Canvas Items */}
                {showOverlay && !error && (
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            pointerEvents: 'none',
                        }}
                    >
                        {items.slice(0, 5).map((item, index) => (
                            <Paper
                                key={item.id}
                                elevation={8}
                                sx={{
                                    position: 'absolute',
                                    // Distribute items across screen based on their canvas position
                                    top: `${15 + (index * 15) % 60}%`,
                                    left: `${10 + (item.positionX % 500) / 6}%`,
                                    maxWidth: 280,
                                    p: 2,
                                    bgcolor: 'rgba(255, 255, 255, 0.92)',
                                    backdropFilter: 'blur(10px)',
                                    borderRadius: 2,
                                    border: '2px solid',
                                    borderColor: item.type === 'NOTE' ? 'primary.main' : 'secondary.main',
                                    transform: `rotate(${(index - 2) * 3}deg)`,
                                    animation: 'float 3s ease-in-out infinite',
                                    animationDelay: `${index * 0.5}s`,
                                    pointerEvents: 'auto',
                                    '@keyframes float': {
                                        '0%, 100%': { transform: `rotate(${(index - 2) * 3}deg) translateY(0)` },
                                        '50%': { transform: `rotate(${(index - 2) * 3}deg) translateY(-10px)` },
                                    },
                                }}
                            >
                                <Chip
                                    label={item.type}
                                    size="small"
                                    color={item.type === 'NOTE' ? 'primary' : 'secondary'}
                                    sx={{ mb: 1 }}
                                />
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    {getPreviewText(item)}
                                </Typography>
                            </Paper>
                        ))}
                    </Box>
                )}

                {/* Toggle Overlay FAB */}
                <Fab
                    color={showOverlay ? 'primary' : 'default'}
                    onClick={() => setShowOverlay(!showOverlay)}
                    sx={{
                        position: 'absolute',
                        bottom: 24,
                        right: 24,
                    }}
                >
                    {showOverlay ? <VisibilityIcon /> : <VisibilityOffIcon />}
                </Fab>

                {/* Item Count Indicator */}
                <Chip
                    label={`${items.length} items on canvas`}
                    sx={{
                        position: 'absolute',
                        bottom: 24,
                        left: 24,
                        bgcolor: 'rgba(0, 0, 0, 0.7)',
                        color: 'white',
                    }}
                />
            </Box>
        </Dialog>
    );
}
