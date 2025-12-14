import React, { useState, useEffect, useRef } from 'react';
import { Box, Paper, InputBase, Typography } from '@mui/material';

import { useSession } from 'next-auth/react';

interface CursorChatProps {
    x: number;
    y: number;
    onSendMessage: (message: string) => void;
    onClose: () => void;
}

export const CursorChat: React.FC<CursorChatProps> = ({ x, y, onSendMessage, onClose }) => {
    const [message, setMessage] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const { data: session } = useSession();

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (message.trim()) {
            onSendMessage(message);
            setMessage('');
            onClose();
        }
    };

    return (
        <Box
            sx={{
                position: 'absolute',
                left: x,
                top: y,
                zIndex: 1000,
                pointerEvents: 'auto',
            }}
        >
            <Paper
                elevation={4}
                component="form"
                onSubmit={handleSubmit}
                sx={{
                    p: '2px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    width: 200,
                    borderRadius: 4,
                    bgcolor: '#0096fd',
                    color: 'white',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <Typography variant="caption" sx={{ mr: 1, fontWeight: 'bold' }}>
                    {session?.user?.name?.split(' ')[0] || 'Me'}:
                </Typography>
                <InputBase
                    ref={inputRef}
                    sx={{ ml: 1, flex: 1, color: 'white', fontSize: '14px' }}
                    placeholder="Say something..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onBlur={onClose}
                />
            </Paper>
        </Box>
    );
};
