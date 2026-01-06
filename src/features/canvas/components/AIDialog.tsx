
import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Tabs,
    Tab,
    Box,
    Typography,
    CircularProgress,
    Alert,
    MenuItem,
    Select,
    FormControl,
    InputLabel,
    Paper
} from '@mui/material';
import { AutoAwesome, Summarize, NoteAdd, Chat as ChatIcon, Send as SendIcon } from '@mui/icons-material';
import { PERSONAS, type PersonaKey } from '@/lib/ai/personas';

interface AIDialogProps {
    open: boolean;
    onClose: () => void;
    canvasId: string;
    onAddNote: (text: string) => void;
    getContext?: () => string;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export function AIDialog({ open, onClose, canvasId, onAddNote, getContext }: AIDialogProps) {
    const [tab, setTab] = useState(0);
    const [prompt, setPrompt] = useState('');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Chat State
    const [persona, setPersona] = useState<PersonaKey>('creative');
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/v1/ai/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });

            if (!response.ok) throw new Error('Generation failed');
            const data = await response.json();
            setResult(data.result);
        } catch {
            setError('Failed to generate text. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleSummarize = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/v1/ai/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ canvasId }),
            });

            if (!response.ok) throw new Error('Summarization failed');
            const data = await response.json();
            setResult(data.summary);
        } catch {
            setError('Failed to summarize canvas. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleChatSend = async () => {
        if (!chatInput.trim()) return;

        const userMsg = chatInput;
        setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setChatInput('');
        setChatLoading(true);

        try {
            // Retrieve context if available
            const contextStr = typeof getContext === 'function' ? getContext() : '';

            const response = await fetch('/api/v1/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg,
                    context: contextStr,
                    persona
                }),
            });

            if (!response.ok) throw new Error('Chat failed');
            const data = await response.json();
            setChatMessages(prev => [...prev, { role: 'assistant', content: data.result }]);
        } catch {
            setChatMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I encountered an error." }]);
        } finally {
            setChatLoading(false);
        }
    };

    const handleAddNote = () => {
        if (result) {
            onAddNote(result);
            onClose();
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AutoAwesome color="primary" />
                AI Assistant
            </DialogTitle>
            <DialogContent>
                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
                    <Tab icon={<NoteAdd />} label="Generate Note" />
                    <Tab icon={<Summarize />} label="Summarize" />
                    <Tab icon={<ChatIcon />} label="Chat" />
                </Tabs>

                <Box sx={{ minHeight: 200 }}>
                    {tab === 0 && (
                        <TextField
                            fullWidth
                            multiline
                            rows={3}
                            label="What would you like to write about?"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="e.g. Brainstorm ideas for a marketing campaign..."
                            disabled={loading}
                        />
                    )}

                    {tab === 1 && (
                        <Typography color="text.secondary" sx={{ mb: 2 }}>
                            Summarize the content of this canvas into a concise overview.
                        </Typography>
                    )}

                    {tab === 2 && (
                        <Box sx={{ height: 400, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Persona</InputLabel>
                                <Select
                                    value={persona}
                                    label="Persona"
                                    onChange={(e) => setPersona(e.target.value as PersonaKey)}
                                >
                                    {Object.entries(PERSONAS).map(([key, def]) => (
                                        <MenuItem key={key} value={key}>{def.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <Paper variant="outlined" sx={{ flexGrow: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {chatMessages.length === 0 && (
                                    <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 4 }}>
                                        Start a conversation with the {PERSONAS[persona].name}...
                                    </Typography>
                                )}
                                {chatMessages.map((msg, idx) => (
                                    <Box key={idx} sx={{
                                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                        maxWidth: '80%',
                                        bgcolor: msg.role === 'user' ? 'primary.main' : 'action.selected',
                                        color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                                        p: 1.5,
                                        borderRadius: 2,
                                        whiteSpace: 'pre-wrap'
                                    }}>
                                        <Typography variant="body2">{msg.content}</Typography>
                                    </Box>
                                ))}
                                {chatLoading && (
                                    <Box sx={{ alignSelf: 'flex-start', p: 1 }}>
                                        <CircularProgress size={20} />
                                    </Box>
                                )}
                            </Paper>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    placeholder="Type a message..."
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleChatSend()}
                                />
                                <Button variant="contained" onClick={handleChatSend} disabled={!chatInput.trim() || chatLoading}>
                                    <SendIcon />
                                </Button>
                            </Box>
                        </Box>
                    )}

                    {error && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {error}
                        </Alert>
                    )}

                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        result && tab !== 2 && (
                            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{result}</Typography>
                            </Box>
                        )
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
                {tab === 0 && (
                    <Button
                        variant={result ? "outlined" : "contained"}
                        onClick={handleGenerate}
                        disabled={loading || !prompt.trim()}
                    >
                        {result ? 'Regenerate' : 'Generate'}
                    </Button>
                )}
                {tab === 1 && (
                    <Button
                        variant={result ? "outlined" : "contained"}
                        onClick={handleSummarize}
                        disabled={loading}
                    >
                        {result ? 'Re-summarize' : 'Summarize'}
                    </Button>
                )}
                {result && tab !== 2 && (
                    <Button variant="contained" onClick={handleAddNote} startIcon={<NoteAdd />}>
                        Add as Note
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
