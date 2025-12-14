
import React, { useState, useEffect, useRef } from 'react';
import { Box, TextField, Fade, Typography, IconButton } from '@mui/material';
import { Mic as MicIcon, Send as SendIcon, Close as CloseIcon } from '@mui/icons-material';

interface WhisperModeProps {
    open: boolean;
    onClose: () => void;
    onSend: (text: string) => void;
}

export function WhisperMode({ open, onClose, onSend }: WhisperModeProps) {
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open && inputRef.current) {
            inputRef.current.focus();
        }
    }, [open]);

    const handleSend = () => {
        if (text.trim()) {
            onSend(text);
            setText('');
            // Optional: Auto-close after sending or keep open for rapid entry?
            // Keeping open for rapid entry style.
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!open) return null;

    return (
        <Fade in={open}>
            <Box
                sx={{
                    position: 'fixed',
                    bottom: 40,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '60%',
                    maxWidth: 600,
                    bgcolor: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                    borderRadius: 4,
                    p: 2,
                    zIndex: 1400,
                    border: '1px solid rgba(255, 255, 255, 0.5)'
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <MicIcon color="action" fontSize="small" sx={{ mr: 1 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                            WHISPER MODE
                        </Typography>
                    </Box>
                    <IconButton size="small" onClick={onClose}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>
                <TextField
                    inputRef={inputRef}
                    fullWidth
                    multiline
                    minRows={1}
                    maxRows={4}
                    placeholder="Whisper your thought..."
                    variant="standard"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    InputProps={{
                        disableUnderline: true,
                        endAdornment: (
                            <IconButton onClick={handleSend} disabled={!text.trim()} color="primary" size="small">
                                <SendIcon />
                            </IconButton>
                        ),
                        style: { fontSize: '1.2rem' }
                    }}
                />
            </Box>
        </Fade>
    );
}
