/**
 * Template Library
 * Browse, use, and manage canvas templates.
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  Box,
  Typography,
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
  IconButton,
  Skeleton,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  alpha,
} from '@mui/material';
import {
  Visibility,
  ExploreOutlined as TemplatesIcon,
  DeleteOutline as DeleteIcon,
} from '@mui/icons-material';
import {
  useTemplates,
  useCreateCanvasFromTemplate,
  useRemoveTemplate,
  type Template,
} from '@/lib/hooks/use-templates';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';

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

function TemplateCardSkeleton({ index }: { index: number }) {
  return (
    <Card sx={{ height: '100%', animation: `fadeIn 0.4s ease-out ${index * 0.06}s both` }}>
      <CardContent>
        <Skeleton width="80%" height={30} sx={{ mb: 1.5 }} />
        <Skeleton width="100%" height={54} sx={{ mb: 1.5 }} />
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <Skeleton width={80} height={24} sx={{ borderRadius: 1 }} />
          <Skeleton width={60} height={24} sx={{ borderRadius: 1 }} />
        </Box>
        <Skeleton width="60%" height={16} />
      </CardContent>
      <CardActions sx={{ p: 2, pt: 0 }}>
        <Skeleton width="100%" height={38} sx={{ borderRadius: 2 }} />
      </CardActions>
    </Card>
  );
}

export function TemplatesContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<'all' | 'my'>('all');
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);

  const userId = filter === 'my' && session?.user?.id ? session.user.id : undefined;
  const { data, isLoading, error } = useTemplates(category === 'all' ? undefined : category, userId);
  const { mutateAsync: createFromTemplate, isPending: isCreating } = useCreateCanvasFromTemplate();
  const removeTemplate = useRemoveTemplate();

  const templates = data?.templates || [];

  const handleUseTemplate = async (templateId: string) => {
    try {
      const newCanvas = await createFromTemplate({ templateId });
      router.push(`/canvas/${newCanvas.id}`);
    } catch {
      toast.error('Failed to create canvas from template');
    }
  };

  const handleDelete = async () => {
    if (!templateToDelete) return;
    try {
      await removeTemplate.mutateAsync({ templateId: templateToDelete.id });
      toast.success('Template removed');
      setTemplateToDelete(null);
    } catch {
      toast.error('Failed to remove template');
    }
  };

  return (
    <>
      <PageHeader
        title="Template library"
        subtitle="Start with a pre-designed canvas, or save your own from any canvas's menu"
      />

      {/* Filters */}
      <Box sx={{ mb: 4, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Category</InputLabel>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} label="Category">
            {TEMPLATE_CATEGORIES.map((cat) => (
              <MenuItem key={cat} value={cat}>
                {cat === 'all' ? 'All categories' : cat}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {session && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_, value) => value && setFilter(value)}
            aria-label="Template ownership filter"
          >
            <ToggleButton value="all" sx={{ px: 2 }}>
              All templates
            </ToggleButton>
            <ToggleButton value="my" sx={{ px: 2 }}>
              My templates
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      {isLoading && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            gap: 2.5,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <TemplateCardSkeleton key={i} index={i} />
          ))}
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          Failed to load templates. Please try again.
        </Alert>
      )}

      {!isLoading && !error && templates.length === 0 && (
        <EmptyState
          icon={TemplatesIcon}
          title="No templates found"
          description={
            filter === 'my'
              ? "You haven't created any templates yet. Save a canvas as a template from the canvas menu."
              : 'Be the first to create a template! Save any canvas as a template from its menu.'
          }
        />
      )}

      {!isLoading && !error && templates.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {templates.length} template{templates.length !== 1 ? 's' : ''} found
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
              gap: 2.5,
            }}
          >
            {templates.map((template, index) => {
              const isOwner = session?.user?.id === template.userId;
              return (
                <Card
                  key={template.id}
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    animation: `fadeIn 0.4s ease-out ${Math.min(index * 0.04, 0.4)}s both`,
                  }}
                >
                  {isOwner && (
                    <Tooltip title="Remove template">
                      <IconButton
                        size="small"
                        aria-label={`Remove template ${template.name}`}
                        onClick={() => setTemplateToDelete(template)}
                        sx={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Typography variant="h6" gutterBottom noWrap fontWeight={600} sx={{ pr: isOwner ? 4 : 0 }}>
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
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                            color: 'primary.main',
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
                      {isOwner ? 'you' : template.user.name || 'Anonymous'}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ p: 2, pt: 0 }}>
                    <Button
                      variant="contained"
                      fullWidth
                      onClick={() => handleUseTemplate(template.id)}
                      disabled={isCreating}
                    >
                      Use template
                    </Button>
                  </CardActions>
                </Card>
              );
            })}
          </Box>
        </>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!templateToDelete} onClose={() => setTemplateToDelete(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>Remove template?</DialogTitle>
        <DialogContent>
          <Typography>
            <strong>{templateToDelete?.name}</strong> will no longer be available as a template. The
            underlying canvas is not deleted.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setTemplateToDelete(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={removeTemplate.isPending}
          >
            {removeTemplate.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
