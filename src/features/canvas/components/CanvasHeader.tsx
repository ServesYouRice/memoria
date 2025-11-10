'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  Typography,
  TextField,
  Button,
  ButtonGroup,
  Tooltip,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  ArrowBack,
  ZoomIn,
  ZoomOut,
  FitScreen,
  MoreVert,
  Search as SearchIcon,
  Clear as ClearIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
} from '@mui/icons-material';

export interface CanvasHeaderProps {
  canvasName: string;
  onCanvasNameChange: (name: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitToScreen: () => void;
  onExportPNG?: () => void;
  onExportPDF?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export function CanvasHeader({
  canvasName,
  onCanvasNameChange,
  zoom,
  onZoomChange,
  onFitToScreen,
  onExportPNG,
  onExportPDF,
  searchQuery = '',
  onSearchChange,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: CanvasHeaderProps) {
  const router = useRouter();
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(canvasName);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [showSearch, setShowSearch] = useState(false);

  const handleBackClick = () => {
    router.push('/dashboard');
  };

  const handleNameClick = () => {
    setIsEditingName(true);
    setEditedName(canvasName);
  };

  const handleNameSave = () => {
    if (editedName.trim()) {
      onCanvasNameChange(editedName.trim());
    } else {
      setEditedName(canvasName);
    }
    setIsEditingName(false);
  };

  const handleNameKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      setEditedName(canvasName);
      setIsEditingName(false);
    }
  };

  const handleZoomIn = () => {
    const newZoom = Math.min(zoom + ZOOM_STEP, MAX_ZOOM);
    onZoomChange(Math.round(newZoom * 100) / 100);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - ZOOM_STEP, MIN_ZOOM);
    onZoomChange(Math.round(newZoom * 100) / 100);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        {/* Back Button */}
        <Tooltip title="Back to Dashboard">
          <IconButton edge="start" onClick={handleBackClick} sx={{ mr: 2 }}>
            <ArrowBack />
          </IconButton>
        </Tooltip>

        {/* Canvas Name */}
        <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
          {showSearch && onSearchChange ? (
            <TextField
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search notes and bookmarks..."
              size="small"
              autoFocus
              sx={{ minWidth: 300, maxWidth: 500 }}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'action.active' }} />,
                endAdornment: searchQuery ? (
                  <IconButton
                    size="small"
                    onClick={() => {
                      onSearchChange('');
                      setShowSearch(false);
                    }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                ) : null,
              }}
            />
          ) : isEditingName ? (
            <TextField
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyPress}
              autoFocus
              size="small"
              variant="outlined"
              sx={{ minWidth: 200, maxWidth: 400 }}
            />
          ) : (
            <Typography
              variant="h6"
              component="div"
              noWrap
              onClick={handleNameClick}
              sx={{
                cursor: 'pointer',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
            >
              {canvasName}
            </Typography>
          )}
        </Box>

        {/* Undo/Redo Controls */}
        {(onUndo || onRedo) && (
          <Box sx={{ mr: 1 }}>
            <Tooltip title="Undo (Ctrl+Z)">
              <span>
                <IconButton onClick={onUndo} disabled={!canUndo} size="small">
                  <UndoIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Redo (Ctrl+Y)">
              <span>
                <IconButton onClick={onRedo} disabled={!canRedo} size="small">
                  <RedoIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}

        {/* Search Toggle */}
        {onSearchChange && !showSearch && !isEditingName && (
          <Tooltip title="Search">
            <IconButton onClick={() => setShowSearch(true)} sx={{ mr: 1 }}>
              <SearchIcon />
            </IconButton>
          </Tooltip>
        )}

        {/* Zoom Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
          <ButtonGroup variant="outlined" size="small" sx={{ mr: 1 }}>
            <Tooltip title="Zoom Out">
              <Button onClick={handleZoomOut} disabled={zoom <= MIN_ZOOM}>
                <ZoomOut />
              </Button>
            </Tooltip>
            <Tooltip title="Fit to Screen">
              <Button onClick={onFitToScreen}>
                <FitScreen />
              </Button>
            </Tooltip>
            <Tooltip title="Zoom In">
              <Button onClick={handleZoomIn} disabled={zoom >= MAX_ZOOM}>
                <ZoomIn />
              </Button>
            </Tooltip>
          </ButtonGroup>
          <Typography variant="body2" sx={{ minWidth: 50, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </Typography>
        </Box>

        {/* Options Menu */}
        <Tooltip title="More Options">
          <IconButton onClick={handleMenuOpen}>
            <MoreVert />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
          <MenuItem
            onClick={() => {
              onExportPNG?.();
              handleMenuClose();
            }}
          >
            Export as PNG
          </MenuItem>
          <MenuItem
            onClick={() => {
              onExportPDF?.();
              handleMenuClose();
            }}
          >
            Export as PDF
          </MenuItem>
          <MenuItem onClick={handleMenuClose}>Canvas Settings</MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
