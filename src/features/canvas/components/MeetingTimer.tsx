import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    IconButton,
    Popover,
    Typography,
    Button,
    TextField,
    Stack
} from '@mui/material';
import { Timer, PlayArrow, Pause, Refresh, Close } from '@mui/icons-material';

export const MeetingTimer: React.FC = () => {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [timeLeft, setTimeLeft] = useState(0);
    const [duration, setDuration] = useState(15); // minutes
    const [isRunning, setIsRunning] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isRunning && timeLeft > 0) {
            timerRef.current = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        setIsRunning(false);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isRunning, timeLeft]);

    const handleStart = () => {
        if (timeLeft === 0) {
            setTimeLeft(duration * 60);
        }
        setIsRunning(true);
    };

    const handlePause = () => {
        setIsRunning(false);
    };

    const handleReset = () => {
        setIsRunning(false);
        setTimeLeft(duration * 60);
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const open = Boolean(anchorEl);

    return (
        <>
            <IconButton
                onClick={(e) => setAnchorEl(e.currentTarget)}
                color={isRunning ? "secondary" : "default"}
            >
                <Timer />
                {isRunning && (
                    <Typography variant="caption" sx={{ ml: 0.5, fontWeight: 'bold' }}>
                        {formatTime(timeLeft)}
                    </Typography>
                )}
            </IconButton>
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
            >
                <Box sx={{ p: 2, width: 250 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6">Meeting Timer</Typography>
                        <IconButton size="small" onClick={() => setAnchorEl(null)}><Close fontSize="small" /></IconButton>
                    </Box>

                    <Typography variant="h3" align="center" sx={{ fontFamily: 'monospace', mb: 2, color: timeLeft < 60 && timeLeft > 0 ? 'error.main' : 'inherit' }}>
                        {formatTime(timeLeft || duration * 60)}
                    </Typography>

                    <Stack direction="row" spacing={1} justifyContent="center" sx={{ mb: 2 }}>
                        {!isRunning ? (
                            <Button
                                variant="contained"
                                color="primary"
                                startIcon={<PlayArrow />}
                                onClick={handleStart}
                            >
                                Start
                            </Button>
                        ) : (
                            <Button
                                variant="contained"
                                color="warning"
                                startIcon={<Pause />}
                                onClick={handlePause}
                            >
                                Pause
                            </Button>
                        )}
                        <IconButton onClick={handleReset} title="Reset">
                            <Refresh />
                        </IconButton>
                    </Stack>

                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <TextField
                            label="Duration (min)"
                            type="number"
                            size="small"
                            value={duration}
                            onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val > 0) {
                                    setDuration(val);
                                    if (!isRunning) setTimeLeft(val * 60);
                                }
                            }}
                            disabled={isRunning}
                        />
                    </Box>
                </Box>
            </Popover>
        </>
    );
};
