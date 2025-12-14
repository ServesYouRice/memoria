
import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Grid,
    Card,
    CardActionArea,
    CardContent,
    Typography,
    Tabs,
    Tab,
    Box,
    Chip
} from '@mui/material';
import {
    Dashboard as DashboardIcon,
    EventNote as RitualIcon,
    Architecture as WorkIcon,
    EmojiObjects as BrainstormIcon
} from '@mui/icons-material';

interface Template {
    id: string;
    title: string;
    description: string;
    category: 'ritual' | 'work' | 'brainstorm';
    items: any[]; // Canvas items definition
}

const TEMPLATES: Template[] = [
    {
        id: 'daily-standup',
        title: 'Daily Standup',
        description: 'A ritual for tracking progress and blockers.',
        category: 'ritual',
        items: [
            { type: 'TEXT', content: { text: '# Daily Standup' }, positionX: 0, positionY: -200, width: 300, height: 50 },
            { type: 'NOTE', content: { text: '**Yesterday**\n- ' }, positionX: -300, positionY: 0, width: 250, height: 200, color: '#e3f2fd' },
            { type: 'NOTE', content: { text: '**Today**\n- ' }, positionX: 0, positionY: 0, width: 250, height: 200, color: '#e8f5e9' },
            { type: 'NOTE', content: { text: '**Blockers**\n- ' }, positionX: 300, positionY: 0, width: 250, height: 200, color: '#ffebee' },
        ]
    },
    {
        id: 'gratitude-journal',
        title: 'Gratitude Journal',
        description: 'Start your day with positivity.',
        category: 'ritual',
        items: [
            { type: 'TEXT', content: { text: '# Gratitude Journal' }, positionX: 0, positionY: -150, width: 400, height: 60 },
            { type: 'NOTE', content: { text: 'I am grateful for...' }, positionX: 0, positionY: 50, width: 400, height: 300, color: '#fff3e0' }
        ]
    },
    {
        id: 'project-kickoff',
        title: 'Project Kickoff',
        description: 'Align the team on goals and scope.',
        category: 'work',
        items: [
            { type: 'TEXT', content: { text: '# Project Kickoff' }, positionX: 0, positionY: -250, width: 500, height: 60 },
            { type: 'NOTE', content: { text: '## Goals\n1. ' }, positionX: -250, positionY: 0, width: 300, height: 250 },
            { type: 'NOTE', content: { text: '## Non-Goals\n1. ' }, positionX: 100, positionY: 0, width: 300, height: 250 },
        ]
    }
];

interface TemplatesGalleryProps {
    open: boolean;
    onClose: () => void;
    onSelectTemplate: (items: any[]) => void;
}

export function TemplatesGallery({ open, onClose, onSelectTemplate }: TemplatesGalleryProps) {
    const [category, setCategory] = useState<'all' | 'ritual' | 'work' | 'brainstorm'>('all');

    const filteredTemplates = category === 'all'
        ? TEMPLATES
        : TEMPLATES.filter(t => t.category === category);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Template Gallery</DialogTitle>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
                <Tabs value={category} onChange={(_, v) => setCategory(v)} textColor="secondary" indicatorColor="secondary">
                    <Tab label="All" value="all" icon={<DashboardIcon />} iconPosition="start" />
                    <Tab label="Rituals" value="ritual" icon={<RitualIcon />} iconPosition="start" />
                    <Tab label="Work" value="work" icon={<WorkIcon />} iconPosition="start" />
                    <Tab label="Brainstorming" value="brainstorm" icon={<BrainstormIcon />} iconPosition="start" />
                </Tabs>
            </Box>
            <DialogContent sx={{ minHeight: 400, py: 3 }}>
                <Grid container spacing={3}>
                    {filteredTemplates.map(template => (
                        <Grid item xs={12} sm={6} md={4} key={template.id}>
                            <Card variant="outlined" sx={{ height: '100%', '&:hover': { borderColor: 'secondary.main' } }}>
                                <CardActionArea
                                    sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start' }}
                                    onClick={() => {
                                        onSelectTemplate(template.items);
                                        onClose();
                                    }}
                                >
                                    <CardContent>
                                        <Typography variant="h6" gutterBottom>
                                            {template.title}
                                        </Typography>
                                        <Box sx={{ mb: 2 }}>
                                            <Chip
                                                label={template.category}
                                                size="small"
                                                color={template.category === 'ritual' ? 'secondary' : 'default'}
                                                variant="outlined"
                                            />
                                        </Box>
                                        <Typography variant="body2" color="text.secondary">
                                            {template.description}
                                        </Typography>
                                    </CardContent>
                                </CardActionArea>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
}
