/**
 * Template Library Page
 * Browse and use canvas templates
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Alert,
  AppBar,
  Toolbar,
  IconButton,
} from '@mui/material';
import { ArrowBack, Visibility } from '@mui/icons-material';
import { useTemplates, useTemplate_CreateFromTemplate } from '@/lib/hooks/use-templates';
import { useSession } from 'next-auth/react';

const TEMPLATE_CATEGORIES = [
  'all',
  'General',
  'Project Planning',
  'Note Taking',
  'Research',
  'Brainstorming',
  'Education',
  'Personal',
  'Business',
  'Creative',
  'Other',
];

export default function TemplatesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<'all' | 'my'>('all');

  const userId = filter === 'my' && session?.user?.id ? session.user.id : undefined;
  const { data, isLoading, error } = useTemplates(category === 'all' ? undefined : category, userId);
  const { mutateAsync: createFromTemplate, isPending: isCreating } = useTemplate_CreateFromTemplate();

  const templates = data?.templates || [];

  const handleUseTemplate = async (templateId: string) => {
    try {
      const newCanvas = await createFromTemplate({ templateId });
      router.push(`/canvas/${newCanvas.id}`);
    } catch (err) {
      console.error('Failed to use template:', err);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <IconButton edge="start" onClick={() => router.push('/dashboard')} sx={{ mr: 2 }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Template Library
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {/* Filters */}
        <Box sx={{ mb: 4, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Category</InputLabel>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} label="Category">
              {TEMPLATE_CATEGORIES.map((cat) => (
                <MenuItem key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {session && (
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Show</InputLabel>
              <Select value={filter} onChange={(e) => setFilter(e.target.value as any)} label="Show">
                <MenuItem value="all">All Templates</MenuItem>
                <MenuItem value="my">My Templates</MenuItem>
              </Select>
            </FormControl>
          )}
        </Box>

        {/* Loading State */}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Error State */}
        {error && (
          <Alert severity="error" sx={{ mb: 4 }}>
            Failed to load templates. Please try again.
          </Alert>
        )}

        {/* Empty State */}
        {!isLoading && !error && templates.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No templates found
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {filter === 'my'
                ? 'You haven\'t created any templates yet. Save a canvas as a template from the canvas menu.'
                : 'Be the first to create a template!'}
            </Typography>
          </Box>
        )}

        {/* Templates Grid */}
        {!isLoading && !error && templates.length > 0 && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {templates.length} template{templates.length !== 1 ? 's' : ''} found
            </Typography>
            <Grid container spacing={3}>
              {templates.map((template) => (
                <Grid item xs={12} sm={6} md={4} key={template.id}>
                  <Card elevation={2}>
                    <CardContent>
                      <Typography variant="h6" gutterBottom noWrap>
                        {template.name}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mb: 2,
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          minHeight: '3.6em',
                        }}
                      >
                        {template.templateDescription || 'No description provided'}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                        {template.templateCategory && (
                          <Chip label={template.templateCategory} size="small" />
                        )}
                        <Chip
                          icon={<Visibility fontSize="small" />}
                          label={`${template.usageCount} use${template.usageCount !== 1 ? 's' : ''}`}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {template.items.length} item{template.items.length !== 1 ? 's' : ''} •
                        By {template.user.name || template.user.email}
                      </Typography>
                    </CardContent>
                    <CardActions>
                      <Button
                        variant="contained"
                        fullWidth
                        onClick={() => handleUseTemplate(template.id)}
                        disabled={isCreating}
                      >
                        Use Template
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        )}
      </Container>
    </Box>
  );
}
