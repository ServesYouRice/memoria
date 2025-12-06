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
  Alert,
  AppBar,
  Toolbar,
  IconButton,
  Skeleton,
  alpha,
} from '@mui/material';
import { ArrowBack, Visibility, BrushOutlined as CanvasIcon } from '@mui/icons-material';
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

// Category color mapping for visual variety
const categoryColors: Record<string, string> = {
  General: '#667eea',
  'Project Planning': '#4caf50',
  'Note Taking': '#ff9800',
  Research: '#2196f3',
  Brainstorming: '#9c27b0',
  Education: '#00bcd4',
  Personal: '#e91e63',
  Business: '#607d8b',
  Creative: '#ff5252',
  Other: '#795548',
};

// Skeleton loading component
function TemplateCardSkeleton({ index }: { index: number }) {
  return (
    <Card
      sx={{
        height: '100%',
        animation: `fadeIn 0.5s ease-out ${index * 0.1}s both`,
      }}
    >
      <CardContent>
        <Skeleton width="80%" height={32} sx={{ mb: 2 }} />
        <Skeleton width="100%" height={60} sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Skeleton width={80} height={24} sx={{ borderRadius: 1 }} />
          <Skeleton width={60} height={24} sx={{ borderRadius: 1 }} />
        </Box>
        <Skeleton width="60%" height={16} />
      </CardContent>
      <CardActions sx={{ p: 2, pt: 0 }}>
        <Skeleton width="100%" height={40} sx={{ borderRadius: 2 }} />
      </CardActions>
    </Card>
  );
}

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
      {/* Header with gradient */}
      <AppBar
        position="static"
        sx={{
          background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
          boxShadow: 'none',
        }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => router.push('/dashboard')}
            sx={{ mr: 2, color: 'white' }}
          >
            <ArrowBack />
          </IconButton>
          <Box>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600, color: 'white' }}>
              Template Library
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)' }}>
              Start with a pre-designed canvas
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {/* Filters */}
        <Box
          sx={{
            mb: 4,
            display: 'flex',
            gap: 2,
            flexWrap: 'wrap',
            animation: 'fadeIn 0.5s ease-out',
          }}
        >
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
              <Select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'my')} label="Show">
                <MenuItem value="all">All Templates</MenuItem>
                <MenuItem value="my">My Templates</MenuItem>
              </Select>
            </FormControl>
          )}
        </Box>

        {/* Loading State */}
        {isLoading && (
          <Grid container spacing={3}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Grid item xs={12} sm={6} md={4} key={i}>
                <TemplateCardSkeleton index={i} />
              </Grid>
            ))}
          </Grid>
        )}

        {/* Error State */}
        {error && (
          <Alert severity="error" sx={{ mb: 4, borderRadius: 2 }}>
            Failed to load templates. Please try again.
          </Alert>
        )}

        {/* Empty State */}
        {!isLoading && !error && templates.length === 0 && (
          <Box
            sx={{
              textAlign: 'center',
              py: 10,
              px: 4,
              borderRadius: 4,
              background: (theme) =>
                theme.palette.mode === 'light'
                  ? 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
                  : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: 2,
              borderStyle: 'dashed',
              borderColor: 'divider',
              animation: 'fadeIn 0.5s ease-out',
            }}
          >
            <Box
              sx={{
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 3,
                animation: 'float 4s ease-in-out infinite',
              }}
            >
              <CanvasIcon sx={{ fontSize: 50, color: 'white' }} />
            </Box>
            <Typography variant="h5" gutterBottom fontWeight={600}>
              No templates found
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 400, mx: 'auto' }}>
              {filter === 'my'
                ? "You haven't created any templates yet. Save a canvas as a template from the canvas menu."
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
              {templates.map((template, index) => (
                <Grid item xs={12} sm={6} md={4} key={template.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      animation: `fadeIn 0.5s ease-out ${index * 0.05}s both`,
                    }}
                  >
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" gutterBottom noWrap fontWeight={600}>
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
                          lineHeight: 1.5,
                        }}
                      >
                        {template.templateDescription || 'No description provided'}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                        {template.templateCategory && (
                          <Chip
                            label={template.templateCategory}
                            size="small"
                            sx={{
                              bgcolor: alpha(
                                categoryColors[template.templateCategory] || '#667eea',
                                0.15
                              ),
                              color: categoryColors[template.templateCategory] || '#667eea',
                              fontWeight: 500,
                            }}
                          />
                        )}
                        <Chip
                          icon={<Visibility sx={{ fontSize: 14 }} />}
                          label={`${template.usageCount} use${template.usageCount !== 1 ? 's' : ''}`}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {template.items.length} item{template.items.length !== 1 ? 's' : ''} • By{' '}
                        {template.user.name || template.user.email}
                      </Typography>
                    </CardContent>
                    <CardActions sx={{ p: 2, pt: 0 }}>
                      <Button
                        variant="contained"
                        fullWidth
                        onClick={() => handleUseTemplate(template.id)}
                        disabled={isCreating}
                        sx={{
                          borderRadius: 2,
                          background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                          boxShadow: '0 4px 15px rgba(17, 153, 142, 0.3)',
                          '&:hover': {
                            boxShadow: '0 6px 20px rgba(17, 153, 142, 0.4)',
                          },
                        }}
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
