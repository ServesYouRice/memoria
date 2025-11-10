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
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useCanvases, useCreateCanvas } from '@/lib/hooks/use-canvases';

export function DashboardContent() {
  const router = useRouter();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState('');

  const { data: canvases, isLoading, error } = useCanvases();
  const createCanvas = useCreateCanvas();

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

  const handleCanvasClick = (canvasId: string) => {
    router.push(`/canvas/${canvasId}`);
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
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="h2">
          My Canvases
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          New Canvas
        </Button>
      </Box>

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
              <Card sx={{ height: '100%' }}>
                <CardActionArea
                  onClick={() => handleCanvasClick(canvas.id)}
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
                    }}
                  >
                    <Typography variant="h4" color="text.secondary">
                      📋
                    </Typography>
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
    </>
  );
}
