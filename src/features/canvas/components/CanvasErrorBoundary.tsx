'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { Warning as WarningIcon, Refresh as RefreshIcon } from '@mui/icons-material';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class CanvasErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Canvas Error Boundary caught an error:', error, errorInfo);
    }

    private handleRetry = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100vh',
                        bgcolor: 'background.default',
                        p: 3,
                    }}
                >
                    <Paper
                        elevation={3}
                        sx={{
                            p: 4,
                            maxWidth: 500,
                            textAlign: 'center',
                            borderRadius: 2,
                        }}
                    >
                        <WarningIcon color="error" sx={{ fontSize: 64, mb: 2 }} />
                        <Typography variant="h5" gutterBottom fontWeight={600}>
                            Something went wrong with the canvas
                        </Typography>
                        <Typography color="text.secondary" paragraph>
                            {this.state.error?.message || 'An unexpected error occurred while rendering the canvas.'}
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<RefreshIcon />}
                            onClick={this.handleRetry}
                            sx={{ mt: 2 }}
                        >
                            Reload Canvas
                        </Button>
                    </Paper>
                </Box>
            );
        }

        return this.props.children;
    }
}
