'use client';

import React from 'react';
import { Box, Slider, Button, Typography, Paper } from '@mui/material';
import { Restore, Close } from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';

interface TimeMachineControlProps {
    versions: any[];
    currentIndex: number;
    onChange: (index: number) => void;
    onRestore: (version: any) => void;
    onExit: () => void;
}

export function TimeMachineControl({ versions, currentIndex, onChange, onRestore, onExit }: TimeMachineControlProps) {
    const currentVersion = versions[currentIndex];

    if (!currentVersion) return null;

    return (
        <Paper
            elevation={3}
            sx={{
                position: 'absolute',
                bottom: 32,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '80%',
                maxWidth: 800,
                p: 3,
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">Time Machine</Typography>
                <Box>
                    <Typography variant="subtitle1" component="span" sx={{ mr: 2, fontWeight: 'bold' }}>
                        {currentVersion.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {formatDistanceToNow(new Date(currentVersion.createdAt), { addSuffix: true })}
                    </Typography>
                </Box>
                <Button startIcon={<Close />} onClick={onExit} size="small">Exit</Button>
            </Box>

            <Slider
                value={currentIndex}
                min={0}
                max={versions.length - 1}
                onChange={(_, val) => onChange(val as number)}
                step={1}
                marks
                valueLabelDisplay="auto"
                valueLabelFormat={(idx) => versions[idx]?.name || ''}
            />

            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<Restore />}
                    onClick={() => onRestore(currentVersion)}
                >
                    Restore This Version
                </Button>
            </Box>
        </Paper>
    );
}
