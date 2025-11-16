'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
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
  Toolbar,
  Chip,
} from '@mui/material';
import {
  Add as AddIcon,
  Explore as ExploreIcon,
  MoreVert,
  ContentCopy as DuplicateIcon,
  Delete as DeleteIcon,
  CheckBoxOutlineBlank,
  CheckBox,
  Close as CloseIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useCanvases, useCreateCanvas, useDuplicateCanvas } from '@/lib/hooks/use-canvases';
import { ActivityFeed } from './ActivityFeed';
import { GlobalSearchDialog } from '@/components/GlobalSearchDialog';
import { CommandPalette } from '@/components/CommandPalette';
import { useThemeMode } from '@/contexts/ThemeContext';
import Link from 'next/link';

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

  const { data: canvases, isLoading, error} = useCanvases();
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
      // Navigate to the new canvas
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

  const selectAll = () => {
    if (!canvases) return;
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
      // Delete canvases via API
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
      // Refresh canvas list
      window.location.reload();
    } catch (err) {
      console.error('Failed to bulk delete canvases:', err);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        Failed to load canvases. Please try again.
      </Alert>
    );
  }

  const hasCanvases = canvases && canvases.length > 0;

  return (
    <>
      <Grid container spacing={3}>
        {/* Left column - Canvases */}
        <Grid item xs={12} md={8}>
          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h5" component="h2">
              My Canvases
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<SearchIcon />}
                onClick={() => setSearchDialogOpen(true)}
              >
                Search
              </Button>
              {hasCanvases && (
                <Button
                  variant="outlined"
                  startIcon={selectionMode ? <CloseIcon /> : <CheckBoxOutlineBlank />}
                  onClick={toggleSelectionMode}
                >
                  {selectionMode ? 'Cancel' : 'Select'}
                </Button>
              )}
              <Button
                component={Link}
                href="/templates"
                variant="outlined"
                startIcon={<ExploreIcon />}
              >
                Templates
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
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
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body1">
                  {selectedCanvasIds.size} selected
                </Typography>
                {selectedCanvasIds.size > 0 && (
                  <Button size="small" onClick={() => setSelectedCanvasIds(new Set())}>
                    Clear
                  </Button>
                )}
                {selectedCanvasIds.size !== canvases?.length && (
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
                >
                  Duplicate
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={selectedCanvasIds.size === 0}
                >
                  Delete
                </Button>
              </Box>
            </Paper>
          )}

      {!hasCanvases ? (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            px: 2,
            border: '2px dashed',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography variant="h6" gutterBottom color="text.secondary">
            No canvases yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Create your first canvas to start organizing your notes and bookmarks
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
            size="large"
          >
            Create Your First Canvas
          </Button>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {canvases.map((canvas) => (
            <Grid item xs={12} sm={6} md={4} key={canvas.id}>
              <Card
                sx={{
                  height: '100%',
                  position: 'relative',
                  border: selectedCanvasIds.has(canvas.id) ? 2 : 0,
                  borderColor: 'primary.main',
                }}
              >
                {selectionMode && (
                  <Checkbox
                    checked={selectedCanvasIds.has(canvas.id)}
                    onChange={() => toggleCanvasSelection(canvas.id)}
                    sx={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                {!selectionMode && (
                  <IconButton
                    sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                    onClick={(e) => handleMenuOpen(e, canvas.id)}
                  >
                    <MoreVert />
                  </IconButton>
                )}
                <CardActionArea
                  onClick={(e) => handleCanvasClick(canvas.id, e)}
                  sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
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
                      <Typography variant="h4" color="text.secondary">
                        📋
                      </Typography>
                    )}
                  </Box>
                  <CardContent sx={{ flexGrow: 1, width: '100%' }}>
                    <Typography variant="h6" gutterBottom noWrap>
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
          <Paper sx={{ p: 3, position: 'sticky', top: 16 }}>
            <ActivityFeed limit={15} />
          </Paper>
        </Grid>
      </Grid>

      {/* Create Canvas Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Canvas</DialogTitle>
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
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateCanvas}
            variant="contained"
            disabled={createCanvas.isPending}
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
      >
        <MenuItem onClick={handleDuplicate}>
          <ListItemIcon>
            <DuplicateIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
      </Menu>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Delete Canvases?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete {selectedCanvasIds.size} canvas(es)? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleBulkDelete} variant="contained" color="error">
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
