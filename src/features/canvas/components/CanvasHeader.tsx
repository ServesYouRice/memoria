"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
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
  Badge,
  ToggleButton,
  ToggleButtonGroup,
  Avatar,
  AvatarGroup,
  Chip,
} from "@mui/material";
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
  Share as ShareIcon,
  LocalOffer as TagIcon,
  GridOn as GridOnIcon,
  GridOff as GridOffIcon,
  FiberManualRecord as OnlineIcon,
  AutoAwesome as AIIcon,
  History as HistoryIcon,
  Shuffle as SerendipityIcon,
  Dashboard as TemplatesIcon,
  AutoFixHigh as AutopilotIcon,
  Edit as EditIcon,
  EditNote as WhisperIcon,
  ViewInAr as ARIcon,
} from "@mui/icons-material";
import { ShareDialog } from "./ShareDialog";

import { ThemeToggle } from "@/components/ThemeToggle";
import { MeetingTimer } from "./MeetingTimer";
import { PresentToAll } from "@mui/icons-material";
import {
  CanvasSecondaryActions,
  type CanvasSecondaryAction,
} from "@/features/canvas/components/CanvasSecondaryActions";

export interface CollaboratorInfo {
  userId: string;
  email: string;
  name?: string;
  color: string;
}

export interface CanvasHeaderProps {
  canvasId: string;
  canvasName: string;
  onCanvasNameChange: (name: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitToScreen: () => void;
  onExport?: () => void;
  onSaveAsTemplate?: () => void;
  onVersionHistory?: () => void;
  onTagFilter?: () => void;
  gridVisible?: boolean;
  onGridToggle?: () => void;
  snapEnabled?: boolean;
  onSnapToggle?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  activeTagCount?: number;
  collaborators?: CollaboratorInfo[];
  collaborationConnected?: boolean;
  collaborationStatus?:
    | "idle"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "error";
  onFollowUser?: (userId: string) => void;
  followingUserId?: string | null;
  viewMode?: "manual" | "organizer";
  onViewModeChange?: (mode: "manual" | "organizer") => void;

  onAI?: () => void;
  onTimeMachine?: () => void;

  onSerendipity?: () => void;
  onTemplates?: () => void;
  onAutopilot?: () => void;
  onWhisper?: () => void;
  onAR?: () => void;
  onPresentationMode?: () => void;
  isPresentationMode?: boolean;
  canManageCanvas?: boolean;
}

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export function CanvasHeader({
  canvasId,
  canvasName,
  onCanvasNameChange,
  zoom,
  onZoomChange,
  onFitToScreen,
  onExport,
  onSaveAsTemplate,
  onVersionHistory,
  onTagFilter,
  gridVisible = false,
  onGridToggle,
  snapEnabled = false,
  onSnapToggle,
  searchQuery = "",
  onSearchChange,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  activeTagCount = 0,
  collaborators = [],
  collaborationConnected = false,
  collaborationStatus = "idle",
  onFollowUser,
  followingUserId,
  viewMode = "manual",
  onViewModeChange,

  onAI,
  onTimeMachine,

  onSerendipity,
  onTemplates,
  onAutopilot,
  onWhisper,
  onAR,
  onPresentationMode,
  isPresentationMode = false,
  canManageCanvas = true,
}: CanvasHeaderProps) {
  const router = useRouter();
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(canvasName);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const handleBackClick = () => {
    router.push("/dashboard");
  };

  const handleNameClick = () => {
    if (!canManageCanvas) return;
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
    if (e.key === "Enter") {
      handleNameSave();
    } else if (e.key === "Escape") {
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

  const statusConfig = {
    connected: {
      label: "Live",
      color: "success",
      tooltip: "Real-time collaboration active",
      iconColor: "#4caf50",
    },
    connecting: {
      label: "Connecting",
      color: "info",
      tooltip: "Connecting to collaboration server",
      iconColor: "#29b6f6",
    },
    reconnecting: {
      label: "Reconnecting",
      color: "warning",
      tooltip: "Reconnecting to collaboration server",
      iconColor: "#ffb74d",
    },
    disconnected: {
      label: "Offline",
      color: "default",
      tooltip: "Collaboration offline",
      iconColor: "#9e9e9e",
    },
    error: {
      label: "Offline",
      color: "error",
      tooltip: "Collaboration error",
      iconColor: "#f44336",
    },
    idle: {
      label: "Offline",
      color: "default",
      tooltip: "Collaboration idle",
      iconColor: "#9e9e9e",
    },
  } as const;

  const statusDisplay = statusConfig[collaborationStatus];
  const showStatus = collaborationStatus !== "idle" || collaborationConnected;
  const secondaryActions: CanvasSecondaryAction[] = [];
  if (onAI)
    secondaryActions.push({
      key: "ai",
      label: "Open AI assistant",
      icon: <AIIcon />,
      onClick: onAI,
      color: "primary",
    });
  if (onSerendipity)
    secondaryActions.push({
      key: "serendipity",
      label: "Surprise me",
      icon: <SerendipityIcon />,
      onClick: onSerendipity,
      color: "secondary",
    });
  if (onTemplates)
    secondaryActions.push({
      key: "templates",
      label: "Open templates and rituals",
      icon: <TemplatesIcon />,
      onClick: onTemplates,
    });
  if (onAutopilot)
    secondaryActions.push({
      key: "autopilot",
      label: "Auto-organize canvas",
      icon: <AutopilotIcon />,
      onClick: onAutopilot,
      color: "primary",
    });
  if (onWhisper)
    secondaryActions.push({
      key: "whisper",
      label: "Open quick capture",
      icon: <WhisperIcon />,
      onClick: onWhisper,
    });
  if (onTimeMachine)
    secondaryActions.push({
      key: "history",
      label: "Open visual history",
      icon: <HistoryIcon />,
      onClick: onTimeMachine,
      color: "secondary",
    });
  if (onAR)
    secondaryActions.push({
      key: "ar",
      label: "Open experimental augmented reality view",
      icon: <ARIcon />,
      onClick: onAR,
      color: "warning",
    });
  if (onTagFilter)
    secondaryActions.push({
      key: "tags",
      label: "Filter canvas by tags",
      icon: (
        <Badge badgeContent={activeTagCount} color="primary">
          <TagIcon />
        </Badge>
      ),
      onClick: onTagFilter,
    });
  if (onSearchChange && !showSearch)
    secondaryActions.push({
      key: "search",
      label: "Search canvas",
      icon: <SearchIcon />,
      onClick: () => setShowSearch(true),
    });

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar sx={{ overflowX: "auto", minHeight: 64 }}>
        {/* Back Button */}
        <Tooltip title="Back to Dashboard">
          <IconButton
            aria-label="Back to dashboard"
            edge="start"
            onClick={handleBackClick}
            sx={{ mr: 2 }}
          >
            <ArrowBack />
          </IconButton>
        </Tooltip>

        {/* Canvas Name */}
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          {showSearch && onSearchChange ? (
            <TextField
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search notes and bookmarks..."
              size="small"
              autoFocus
              sx={{ minWidth: { xs: 180, sm: 300 }, maxWidth: 500 }}
              InputProps={{
                startAdornment: (
                  <SearchIcon sx={{ mr: 1, color: "action.active" }} />
                ),
                endAdornment: searchQuery ? (
                  <IconButton
                    aria-label="Clear canvas search"
                    size="small"
                    onClick={() => {
                      onSearchChange("");
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
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                flexWrap: "wrap",
              }}
            >
              <Typography
                variant="h6"
                component="h1"
                noWrap
                sx={{
                  cursor: "default",
                }}
              >
                {canvasName}
              </Typography>
              {canManageCanvas && (
                <IconButton
                  size="small"
                  aria-label={`Rename canvas ${canvasName}`}
                  onClick={handleNameClick}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              )}
              {onViewModeChange && (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={viewMode}
                  onChange={(_event, nextMode) => {
                    if (nextMode) {
                      onViewModeChange(nextMode);
                    }
                  }}
                >
                  <ToggleButton value="manual">Manual</ToggleButton>
                  <ToggleButton value="organizer">Organizer</ToggleButton>
                </ToggleButtonGroup>
              )}
            </Box>
          )}
        </Box>

        {/* Undo/Redo Controls */}
        {(onUndo || onRedo) && (
          <Box sx={{ mr: 1 }}>
            <Tooltip title="Undo (Ctrl+Z)">
              <span>
                <IconButton
                  aria-label="Undo"
                  onClick={onUndo}
                  disabled={!canUndo}
                  size="small"
                >
                  <UndoIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Redo (Ctrl+Y)">
              <span>
                <IconButton
                  aria-label="Redo"
                  onClick={onRedo}
                  disabled={!canRedo}
                  size="small"
                >
                  <RedoIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}

        {/* Share Button */}
        {canManageCanvas && (
          <Tooltip title="Share Canvas">
            <IconButton
              aria-label="Share canvas"
              onClick={() => setShareDialogOpen(true)}
              sx={{ mr: 1 }}
            >
              <ShareIcon />
            </IconButton>
          </Tooltip>
        )}

        {/* Collaboration Indicator */}
        {(collaborators.length > 0 || showStatus) && (
          <Box sx={{ display: "flex", alignItems: "center", mr: 2, gap: 1 }}>
            {collaborators.length > 0 && (
              <AvatarGroup
                max={5}
                sx={{
                  "& .MuiAvatar-root": { width: 32, height: 32, fontSize: 14 },
                }}
              >
                {collaborators.map((collaborator) => (
                  <Tooltip
                    key={collaborator.userId}
                    title={`${collaborator.name || collaborator.email} ${onFollowUser ? "(Click to follow)" : "(viewing)"}`}
                  >
                    <Avatar
                      sx={{
                        bgcolor: collaborator.color,
                        width: 32,
                        height: 32,
                        fontSize: 14,
                        fontWeight: "bold",
                        cursor: onFollowUser ? "pointer" : "default",
                        border:
                          followingUserId === collaborator.userId
                            ? "2px solid #29b6f6"
                            : "1px solid #fff",
                        boxSizing: "border-box",
                      }}
                      onClick={() =>
                        onFollowUser && onFollowUser(collaborator.userId)
                      }
                    >
                      {(collaborator.name || collaborator.email)
                        .charAt(0)
                        .toUpperCase()}
                    </Avatar>
                  </Tooltip>
                ))}
              </AvatarGroup>
            )}
            {showStatus && (
              <Tooltip title={statusDisplay.tooltip}>
                <Chip
                  icon={
                    <OnlineIcon
                      sx={{ fontSize: 12, color: statusDisplay.iconColor }}
                    />
                  }
                  label={statusDisplay.label}
                  size="small"
                  color={statusDisplay.color}
                  variant={
                    collaborationStatus === "connected" ? "filled" : "outlined"
                  }
                  sx={{
                    height: 24,
                    fontSize: 11,
                    color: "text.primary",
                    "& .MuiChip-icon": {
                      marginLeft: 0.5,
                    },
                  }}
                />
              </Tooltip>
            )}
          </Box>
        )}

        {/* Meeting Timer */}
        <Box sx={{ mr: 1 }}>
          <MeetingTimer />
        </Box>

        {/* Presentation Mode */}
        {onPresentationMode && (
          <Tooltip
            title={
              isPresentationMode ? "Exit Presentation" : "Presentation Mode"
            }
          >
            <IconButton
              aria-label={
                isPresentationMode ? "Exit presentation" : "Enter presentation"
              }
              onClick={onPresentationMode}
              color={isPresentationMode ? "secondary" : "default"}
              sx={{ mr: 1 }}
            >
              <PresentToAll />
            </IconButton>
          </Tooltip>
        )}

        {/* Theme Toggle */}
        <Box sx={{ mr: 1 }}>
          <ThemeToggle />
        </Box>

        <CanvasSecondaryActions actions={secondaryActions} />

        {/* Zoom Controls */}
        <ButtonGroup size="small" sx={{ mr: 2 }}>
          <Tooltip title="Zoom Out">
            <Button onClick={handleZoomOut}>
              <ZoomOut fontSize="small" />
            </Button>
          </Tooltip>
          <Button onClick={onFitToScreen} sx={{ minWidth: "60px" }}>
            {Math.round(zoom * 100)}%
          </Button>
          <Tooltip title="Zoom In">
            <Button onClick={handleZoomIn}>
              <ZoomIn fontSize="small" />
            </Button>
          </Tooltip>
        </ButtonGroup>

        {/* Grid and Snap Toggles */}
        <Box sx={{ display: "flex", mr: 2 }}>
          {onGridToggle && (
            <Tooltip title={gridVisible ? "Hide Grid" : "Show Grid"}>
              <ToggleButton
                value="grid"
                selected={gridVisible}
                onChange={onGridToggle}
                size="small"
                sx={{ mr: 0.5 }}
              >
                {gridVisible ? (
                  <GridOnIcon fontSize="small" />
                ) : (
                  <GridOffIcon fontSize="small" />
                )}
              </ToggleButton>
            </Tooltip>
          )}
          {onSnapToggle && (
            <Tooltip
              title={
                snapEnabled ? "Disable Snap to Grid" : "Enable Snap to Grid"
              }
            >
              <ToggleButton
                value="snap"
                selected={snapEnabled}
                onChange={onSnapToggle}
                size="small"
              >
                <FitScreen fontSize="small" />
              </ToggleButton>
            </Tooltip>
          )}
        </Box>

        {/* More Menu */}
        <Tooltip title="More options">
          <IconButton
            aria-label="More canvas options"
            edge="end"
            onClick={handleMenuOpen}
          >
            <MoreVert />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          {onExport && (
            <MenuItem
              onClick={() => {
                onExport();
                handleMenuClose();
              }}
            >
              Export Canvas
            </MenuItem>
          )}
          {onSaveAsTemplate && (
            <MenuItem
              onClick={() => {
                onSaveAsTemplate();
                handleMenuClose();
              }}
            >
              Save as Template
            </MenuItem>
          )}
          {onVersionHistory && (
            <MenuItem
              onClick={() => {
                onVersionHistory();
                handleMenuClose();
              }}
            >
              Version History
            </MenuItem>
          )}
        </Menu>
      </Toolbar>

      {canManageCanvas && (
        <ShareDialog
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          canvasId={canvasId}
          canvasName={canvasName}
        />
      )}
    </AppBar>
  );
}
