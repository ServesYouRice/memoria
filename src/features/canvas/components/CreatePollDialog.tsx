'use client';

import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Switch,
    FormControlLabel,
    IconButton,
    Box
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import { useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { ItemType } from '@/types/canvas';
import { nanoid } from 'nanoid';

interface CreatePollDialogProps {
    open: boolean;
    onClose: () => void;
    canvasId: string;
    initialPosition?: { x: number; y: number };
}

export function CreatePollDialog({ open, onClose, canvasId, initialPosition }: CreatePollDialogProps) {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState<string[]>(['', '']);
    const [multipleChoice, setMultipleChoice] = useState(false);
    const { mutate: createItem, isPending } = useCreateCanvasItem();

    const handleAddOption = () => setOptions([...options, '']);
    const handleRemoveOption = (index: number) => setOptions(options.filter((_, i) => i !== index));
    const handleOptionChange = (index: number, value: string) => {
        const newOpts = [...options];
        newOpts[index] = value;
        setOptions(newOpts);
    };

    const handleSubmit = () => {
        const validOptions = options.filter(o => o.trim() !== '');
        if (!question.trim() || validOptions.length < 2) return;

        createItem({
            canvasId,
            type: ItemType.POLL,
            positionX: initialPosition?.x || 100,
            positionY: initialPosition?.y || 100,
            width: 300,
            height: 300, // Default, will be used by renderer
            zIndex: 1,
            content: {
                question,
                options: validOptions.map(text => ({
                    id: nanoid(),
                    text,
                    votes: []
                })),
                multipleChoice
            } as any,
            tags: []
        });
        onClose();
        // Reset form
        setQuestion('');
        setOptions(['', '']);
        setMultipleChoice(false);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Create Poll</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    label="Question"
                    fullWidth
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                />
                <Box sx={{ mt: 2 }}>
                    {options.map((opt, index) => (
                        <Box key={index} sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            <TextField
                                placeholder={`Option ${index + 1}`}
                                value={opt}
                                onChange={(e) => handleOptionChange(index, e.target.value)}
                                fullWidth
                                size="small"
                            />
                            <IconButton onClick={() => handleRemoveOption(index)} disabled={options.length <= 2} edge="end">
                                <Delete />
                            </IconButton>
                        </Box>
                    ))}
                    <Button startIcon={<Add />} onClick={handleAddOption} size="small">Add Option</Button>
                </Box>
                <FormControlLabel
                    control={<Switch checked={multipleChoice} onChange={(e) => setMultipleChoice(e.target.checked)} />}
                    label="Allow Multiple Choice"
                    sx={{ mt: 2 }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} variant="contained" disabled={isPending || !question.trim() || options.filter(o => o.trim()).length < 2}>
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );
}
