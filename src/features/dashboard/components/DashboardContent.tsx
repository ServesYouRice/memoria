'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  TextField,
  Typography,
  Alert,
  Paper,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Checkbox,
  Skeleton,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  Explore as ExploreIcon,
  MoreVert,
  ContentCopy as DuplicateIcon,
  Delete as DeleteIcon,
  CheckBoxOutlineBlank,
  Close as CloseIcon,
  Search as SearchIcon,
  BrushOutlined as CanvasIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useCanvases, useCreateCanvas, useDuplicateCanvas } from '@/lib/hooks/use-canvases';
import { ActivityFeed } from './ActivityFeed';
import { GlobalSearchDialog } from '@/components/GlobalSearchDialog';
import { CommandPalette } from '@/components/CommandPalette';
import { useThemeMode } from '@/lib/theme-context';
import Link from 'next/link';

// Skeleton loading component for canvas cards
function CanvasCardSkeleton({ index }: { index: number }) {
  return (
    <Card
      sx={{
        height: '100%',
        animation: `fadeIn 0.5s ease-out ${index * 0.1}s both`,
      }}
    >
      <Skeleton
        variant="rectangular"
        height={160}
        sx={{
          animation: 'shimmer 1.5s ease-in-out infinite',
          background: (theme) =>
            `linear-gradient(90deg, ${alpha(theme.palette.action.hover, 0.5)} 0%, ${alpha(
              theme.palette.action.selected,
              0.5
            )} 50%, ${alpha(theme.palette.action.hover, 0.5)} 100%)`,
          backgroundSize: '200% 100%',
        }}
      />
      <CardContent>
        <Skeleton width="70%" height={28} sx={{ mb: 1 }} />
        <Skeleton width="40%" height={16} />
      </CardContent>
    </Card>
  );
}

export function DashboardContent() {
  const router = useRouter();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<{ element: HTMLElement; canvasId: string } | null>(null);
  const [selectedCanvasIds, setSelectedCanvasIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const { data: canvasesData, isLoading, error } = useCanvases();
  const createCanvas = useCreateCanvas();
  const duplicateCanvas = useDuplicateCanvas();
  const { mode, toggleTheme } = useThemeMode();

  const handleCreateCanvas = async () => {
    try {
      const canvas = await createCanvas.mutateAsync({
        name: newCanvasName || undefined,
      });
      setCreateDialogOpen(false);
      setNewCanvasName('');
      router.push(`/canvas/${canvas.id}`);
    } catch (err) {
      console.error('Failed to create canvas:', err);
    }
  };

  // Command palette keyboard shortcut
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCanvasClick = (canvasId: string, event?: React.MouseEvent) => {
    if (selectionMode) {
      event?.stopPropagation();
      toggleCanvasSelection(canvasId);
    } else {
      router.push(`/canvas/${canvasId}`);
    }
  };

  const toggleCanvasSelection = (canvasId: string) => {
    const newSelected = new Set(selectedCanvasIds);
    if (newSelected.has(canvasId)) {
      newSelected.delete(canvasId);
    } else {
      newSelected.add(canvasId);
    }
    setSelectedCanvasIds(newSelected);
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) {
      setSelectedCanvasIds(new Set());
    }
  };

  const canvases = canvasesData?.canvases ?? [];

  const selectAll = () => {
    setSelectedCanvasIds(new Set(canvases.map((c) => c.id)));
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, canvasId: string) => {
    event.stopPropagation();
    setMenuAnchor({ element: event.currentTarget, canvasId });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleDuplicate = async () => {
    if (!menuAnchor) return;
    try {
      await duplicateCanvas.mutateAsync(menuAnchor.canvasId);
      handleMenuClose();
    } catch (err) {
      console.error('Failed to duplicate canvas:', err);
    }
  };

  const handleBulkDuplicate = async () => {
    try {
      await Promise.all(
        Array.from(selectedCanvasIds).map((id) => duplicateCanvas.mutateAsync(id))
      );
      setSelectedCanvasIds(new Set());
      setSelectionMode(false);
    } catch (err) {
      console.error('Failed to bulk duplicate canvases:', err);
    }
  };

  const handleBulkDelete = async () => {
    try {
      await Promise.all(
        Array.from(selectedCanvasIds).map(async (id) => {
          const response = await fetch(`/api/v1/canvases/${id}`, {
            method: 'DELETE',
          });
          if (!response.ok) throw new Error('Failed to delete canvas');
        })
      );
      setSelectedCanvasIds(new Set());
      setSelectionMode(false);
      setDeleteConfirmOpen(false);
      window.location.reload();
    } catch (err) {
      console.error('Failed to bulk delete canvases:', err);
    }
  };

  const hasCanvases = canvases.length > 0;

  return (
    <>
      <Grid container spacing={3}>
        {/* Left column - Canvases */}
        <Grid item xs={12} md={8}>
          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <Box>
              <Typography
                variant="h4"
                component="h2"
                sx={{
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                My Canvases
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {isLoading ? 'Loading...' : `${canvases.length} canvases`}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                startIcon={<SearchIcon />}
                onClick={() => setSearchDialogOpen(true)}
                sx={{ borderRadius: 2 }}
              >
                Search
              </Button>
              {hasCanvases && (
                <Button
                  variant="outlined"
                  startIcon={selectionMode ? <CloseIcon /> : <CheckBoxOutlineBlank />}
                  onClick={toggleSelectionMode}
                  sx={{ borderRadius: 2 }}
                >
                  {selectionMode ? 'Cancel' : 'Select'}
                </Button>
              )}
              <Button
                component={Link}
                href="/templates"
                variant="outlined"
                startIcon={<ExploreIcon />}
                sx={{ borderRadius: 2 }}
              >
                Templates
              </Button>
              <Button
                component={Link}
                href="/settings"
                variant="outlined"
                startIcon={<SettingsIcon />}
                sx={{ borderRadius: 2, display: { xs: 'none', sm: 'flex' } }}
              >
                Settings
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
                sx={{
                  borderRadius: 2,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)',
                  '&:hover': {
                    boxShadow: '0 6px 30px rgba(102, 126, 234, 0.4)',
                  },
                }}
              >
                New Canvas
              </Button>
            </Box>
          </Box>

          {/* Bulk Actions Toolbar */}
          {selectionMode && (
            <Paper
              sx={{
                mb: 2,
                p: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderRadius: 3,
                background: (theme) => alpha(theme.palette.primary.main, 0.05),
                border: (theme) => `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                animation: 'fadeIn 0.3s ease-out',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body1" fontWeight={500}>
                  {selectedCanvasIds.size} selected
                </Typography>
                {selectedCanvasIds.size > 0 && (
                  <Button size="small" onClick={() => setSelectedCanvasIds(new Set())}>
                    Clear
                  </Button>
                )}
                {selectedCanvasIds.size !== canvases.length && (
                  <Button size="small" onClick={selectAll}>
                    Select All
                  </Button>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<DuplicateIcon />}
                  onClick={handleBulkDuplicate}
                  disabled={selectedCanvasIds.size === 0}
                  sx={{ borderRadius: 2 }}
                >
                  Duplicate
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={selectedCanvasIds.size === 0}
                  sx={{ borderRadius: 2 }}
                >
                  Delete
                </Button>
              </Box>
            </Paper>
          )}

          {/* Error State */}
          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
              Failed to load canvases. Please try again.
            </Alert>
          )}

          {/* Loading State with Skeleton */}
          {isLoading && (
            <Grid container spacing={3}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Grid item xs={12} sm={6} md={4} key={i}>
                  <CanvasCardSkeleton index={i} />
                </Grid>
              ))}
            </Grid>
          )}

          {/* Empty State */}
          {!isLoading && !hasCanvases && (
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
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
                No canvases yet
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400, mx: 'auto' }}>
                Create your first canvas to start organizing your notes, bookmarks, and ideas in an infinite workspace.
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
                size="large"
                sx={{
                  px: 4,
                  py: 1.5,
                  borderRadius: 3,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  boxShadow: '0 8px 30px rgba(102, 126, 234, 0.4)',
                }}
              >
                Create Your First Canvas
              </Button>
            </Box>
          )}

          {/* Canvas Grid */}
          {!isLoading && hasCanvases && (
            <Grid container spacing={3}>
              {canvases.map((canvas, index) => (
                <Grid item xs={12} sm={6} md={4} key={canvas.id}>
                  <Card
                    sx={{
                      height: '100%',
                      position: 'relative',
                      border: selectedCanvasIds.has(canvas.id) ? 2 : 0,
                      borderColor: 'primary.main',
                      animation: `fadeIn 0.5s ease-out ${index * 0.05}s both`,
                      cursor: selectionMode ? 'pointer' : 'default',
                    }}
                  >
                    {selectionMode && (
                      <Checkbox
                        checked={selectedCanvasIds.has(canvas.id)}
                        onChange={() => toggleCanvasSelection(canvas.id)}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          zIndex: 2,
                          bgcolor: 'background.paper',
                          borderRadius: 1,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {!selectionMode && (
                      <IconButton
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          zIndex: 2,
                          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.8),
                          backdropFilter: 'blur(4px)',
                          '&:hover': {
                            bgcolor: 'background.paper',
                          },
                        }}
                        onClick={(e) => handleMenuOpen(e, canvas.id)}
                        size="small"
                      >
                        <MoreVert fontSize="small" />
                      </IconButton>
                    )}
                    <CardActionArea
                      onClick={(e) => handleCanvasClick(canvas.id, e)}
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                      }}
                    >
                      <Box
                        sx={{
                          width: '100%',
                          height: 160,
                          bgcolor: 'action.hover',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          position: 'relative',
                          background: (theme) =>
                            theme.palette.mode === 'light'
                              ? `linear-gradient(135deg, ${alpha('#667eea', 0.1)} 0%, ${alpha(
                                '#764ba2',
                                0.1
                              )} 100%)`
                              : `linear-gradient(135deg, ${alpha('#667eea', 0.2)} 0%, ${alpha(
                                '#764ba2',
                                0.2
                              )} 100%)`,
                        }}
                      >
                        {canvas.thumbnail ? (
                          <Box
                            component="img"
                            src={canvas.thumbnail}
                            alt={`${canvas.name} thumbnail`}
                            sx={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        ) : (
                          <CanvasIcon sx={{ fontSize: 60, color: 'primary.main', opacity: 0.5 }} />
                        )}
                      </Box>
                      <CardContent sx={{ flexGrow: 1, width: '100%' }}>
                        <Typography variant="h6" gutterBottom noWrap fontWeight={600}>
                          {canvas.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Updated {new Date(canvas.updatedAt).toLocaleDateString()}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Grid>

        {/* Right column - Activity Feed */}
        <Grid item xs={12} md={4}>
          <Paper
            sx={{
              p: 3,
              position: 'sticky',
              top: 16,
              borderRadius: 3,
              animation: 'fadeIn 0.5s ease-out 0.2s both',
            }}
          >
            <ActivityFeed limit={15} />
          </Paper>
        </Grid>
      </Grid>

      {/* Create Canvas Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Create New Canvas</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Canvas Name"
            type="text"
            fullWidth
            variant="outlined"
            value={newCanvasName}
            onChange={(e) => setNewCanvasName(e.target.value)}
            placeholder="Untitled Canvas"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleCreateCanvas();
              }
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setCreateDialogOpen(false)} sx={{ borderRadius: 2 }}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateCanvas}
            variant="contained"
            disabled={createCanvas.isPending}
            sx={{
              borderRadius: 2,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            }}
          >
            {createCanvas.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Canvas Action Menu */}
      <Menu
        anchorEl={menuAnchor?.element}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        PaperProps={{
          sx: { borderRadius: 2, minWidth: 150 },
        }}
      >
        <MenuItem onClick={handleDuplicate} sx={{ borderRadius: 1, mx: 1 }}>
          <ListItemIcon>
            <DuplicateIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
      </Menu>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        PaperProps={{
          sx: { borderRadius: 3 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Delete Canvases?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete {selectedCanvasIds.size} canvas(es)? This action cannot
            be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)} sx={{ borderRadius: 2 }}>
            Cancel
          </Button>
          <Button onClick={handleBulkDelete} variant="contained" color="error" sx={{ borderRadius: 2 }}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Global Search Dialog */}
      <GlobalSearchDialog open={searchDialogOpen} onClose={() => setSearchDialogOpen(false)} />

      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCreateCanvas={() => setCreateDialogOpen(true)}
        onSearch={() => setSearchDialogOpen(true)}
        onToggleTheme={toggleTheme}
        isDarkMode={mode === 'dark'}
      />
    </>
  );
}
