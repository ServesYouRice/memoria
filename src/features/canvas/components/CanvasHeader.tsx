"use client";

import React, { useRef, useState } from "react";
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
  ToggleButton,
  ToggleButtonGroup,
  Avatar,
  AvatarGroup,
  Chip,
  ListItemIcon,
  ListItemText,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ArrowBack,
  ZoomIn,
  ZoomOut,
  FitScreen,
  MoreVert,
  Search as SearchIcon,
  Clear as ClearIcon,
  Share as ShareIcon,
  LocalOffer as TagIcon,
  GridOn as GridOnIcon,
  GridOff as GridOffIcon,
  FiberManualRecord as OnlineIcon,
  AutoAwesome as AIIcon,
  History as HistoryIcon,
  Shuffle as SerendipityIcon,
  AutoFixHigh as AutopilotIcon,
  Edit as EditIcon,
  EditNote as WhisperIcon,
  ViewInAr as ARIcon,
  ViewQuilt as PilesIcon,
  Timer as TimerIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  FileDownload as ExportIcon,
  Restore as VersionHistoryIcon,
  ViewModule as OrganizerIcon,
  PanTool as ManualIcon,
  Person as FollowIcon,
} from "@mui/icons-material";
import { ShareDialog } from "./ShareDialog";
import type { AutosaveStatus } from "@/lib/autosave/serialized-delta-queue";
import { describeSaveStatus } from "@/features/canvas/save-status";

import { ThemeToggle } from "@/components/ThemeToggle";
import { useThemeMode } from "@/lib/theme-context";
import { MeetingTimer } from "./MeetingTimer";
import { isArCanvasEnabled } from "@/lib/product-surfaces";
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
  onVersionHistory?: () => void;
  onTagFilter?: () => void;
  gridVisible?: boolean;
  onGridToggle?: () => void;
  snapEnabled?: boolean;
  onSnapToggle?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
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
  onAutopilot?: () => void;
  onSortIntoPiles?: () => void;
  onWhisper?: () => void;
  onAR?: () => void;
  onPresentationMode?: () => void;
  isPresentationMode?: boolean;
  canManageCanvas?: boolean;
  saveStatus?: AutosaveStatus;
  saveError?: string | null;
  /**
   * IMP-045: with an offline status from the collaborative document, the
   * edits kept on this device that the server has not stored yet.
   */
  offlineChanges?: number;
  /** The device copy could not be written: those edits are only in this tab. */
  deviceCopyFailed?: boolean;
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
  onVersionHistory,
  onTagFilter,
  gridVisible = false,
  onGridToggle,
  snapEnabled = false,
  onSnapToggle,
  searchQuery = "",
  onSearchChange,
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
  onAutopilot,
  onSortIntoPiles,
  onWhisper,
  onAR,
  onPresentationMode,
  isPresentationMode = false,
  canManageCanvas = true,
  saveStatus,
  saveError,
  offlineChanges,
  deviceCopyFailed,
}: CanvasHeaderProps) {
  const router = useRouter();
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(canvasName);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [timerAnchor, setTimerAnchor] = useState<HTMLElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const theme = useTheme();
  // IMP-078: phones get a short bar (back, title, share, "More") with every
  // other action in one labelled menu. Wider screens keep the full bar.
  const compact = useMediaQuery(theme.breakpoints.down("sm"));
  const { mode: themeMode, toggleTheme } = useThemeMode();

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
      iconColor: "success.main",
    },
    connecting: {
      label: "Connecting",
      color: "info",
      tooltip: "Connecting to collaboration server",
      iconColor: "info.main",
    },
    reconnecting: {
      label: "Reconnecting",
      color: "warning",
      tooltip: "Reconnecting to collaboration server",
      iconColor: "warning.main",
    },
    disconnected: {
      label: "Offline",
      color: "default",
      tooltip: "Collaboration offline",
      iconColor: "text.disabled",
    },
    error: {
      label: "Offline",
      color: "error",
      tooltip: "Collaboration error",
      iconColor: "error.main",
    },
    idle: {
      label: "Offline",
      color: "default",
      tooltip: "Collaboration idle",
      iconColor: "text.disabled",
    },
  } as const;

  const statusDisplay = statusConfig[collaborationStatus];
  const showStatus = collaborationStatus !== "idle" || collaborationConnected;
  // IMP-022: secondary actions are declared once and laid out responsively —
  // inline from md up, one overflow menu below it. Only actions the caller
  // supplied appear, so capability gating upstream still holds.
  const secondaryActions: CanvasSecondaryAction[] = [
    onAI && {
      key: "ai",
      label: "AI assistant",
      icon: <AIIcon />,
      onClick: onAI,
      color: "primary" as const,
    },
    onSerendipity && {
      key: "serendipity",
      label: "Surprise me",
      icon: <SerendipityIcon />,
      onClick: onSerendipity,
      color: "secondary" as const,
    },
    onAutopilot && {
      key: "autopilot",
      label: "Auto-organize canvas",
      icon: <AutopilotIcon />,
      onClick: onAutopilot,
      color: "primary" as const,
    },
    onSortIntoPiles && {
      key: "sort-into-piles",
      label: "Sort into piles",
      icon: <PilesIcon />,
      onClick: onSortIntoPiles,
      color: "primary" as const,
    },
    onWhisper && {
      key: "whisper",
      label: "Quick capture",
      icon: <WhisperIcon />,
      onClick: onWhisper,
    },
    onTimeMachine && {
      key: "time-machine",
      label: "Visual history",
      icon: <HistoryIcon />,
      onClick: onTimeMachine,
      color: "secondary" as const,
    },
    // DEC-013: hidden unless a deployment opts in explicitly.
    onAR &&
      isArCanvasEnabled() && {
        key: "ar",
        label: "Augmented reality view (experimental)",
        icon: <ARIcon />,
        onClick: onAR,
        color: "warning" as const,
      },
    onTagFilter && {
      key: "tags",
      label: "Filter canvas by tags",
      icon: <TagIcon />,
      onClick: onTagFilter,
      badgeCount: activeTagCount,
    },
    onSearchChange &&
      !showSearch && {
        key: "search",
        label: "Search canvas",
        icon: <SearchIcon />,
        onClick: () => setShowSearch(true),
      },
  ].filter(Boolean) as CanvasSecondaryAction[];

  const searchField = (
    <TextField
      value={searchQuery}
      onChange={(e) => onSearchChange?.(e.target.value)}
      placeholder="Search notes and bookmarks..."
      size="small"
      autoFocus
      sx={{
        minWidth: { xs: 0, sm: 300 },
        width: { xs: "100%", sm: "auto" },
        maxWidth: 500,
      }}
      slotProps={{
        input: {
          startAdornment: <SearchIcon sx={{ mr: 1, color: "action.active" }} />,
          endAdornment: searchQuery ? (
            <IconButton
              aria-label="Clear canvas search"
              size="small"
              onClick={() => {
                onSearchChange?.("");
                setShowSearch(false);
              }}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          ) : null,
        },
      }}
    />
  );

  const nameEditor = (
    <TextField
      value={editedName}
      onChange={(e) => setEditedName(e.target.value)}
      onBlur={handleNameSave}
      onKeyDown={handleNameKeyPress}
      autoFocus
      size="small"
      variant="outlined"
      sx={{
        minWidth: { xs: 0, sm: 200 },
        width: { xs: "100%", sm: "auto" },
        maxWidth: 400,
      }}
    />
  );

  if (compact) {
    const tap = { minWidth: 44, minHeight: 44 };
    const saveDisplay = saveStatus
      ? describeSaveStatus(saveStatus, { offlineChanges, deviceCopyFailed })
      : null;
    const saveDotColor =
      saveStatus === "saved"
        ? "success.main"
        : saveStatus === "saving"
          ? "info.main"
          : saveStatus === "offline/retrying"
            ? "warning.main"
            : "error.main";
    const run = (action: () => void) => () => {
      handleMenuClose();
      action();
    };
    type MenuEntry = {
      key: string;
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
      selected?: boolean;
    };
    const entries: MenuEntry[] = [
      canManageCanvas && {
        key: "rename",
        label: "Rename canvas",
        icon: <EditIcon fontSize="small" />,
        onClick: handleNameClick,
      },
      onViewModeChange && {
        key: "view-mode",
        label:
          viewMode === "manual"
            ? "Switch to Organizer view"
            : "Switch to Manual view",
        icon:
          viewMode === "manual" ? (
            <OrganizerIcon fontSize="small" />
          ) : (
            <ManualIcon fontSize="small" />
          ),
        onClick: () =>
          onViewModeChange(viewMode === "manual" ? "organizer" : "manual"),
      },
      ...secondaryActions.map((action) => ({
        key: action.key,
        label: action.badgeCount
          ? `${action.label} (${action.badgeCount})`
          : action.label,
        icon: action.icon,
        onClick: action.onClick,
      })),
      {
        key: "zoom-in",
        label: "Zoom in",
        icon: <ZoomIn fontSize="small" />,
        onClick: handleZoomIn,
      },
      {
        key: "zoom-out",
        label: "Zoom out",
        icon: <ZoomOut fontSize="small" />,
        onClick: handleZoomOut,
      },
      {
        key: "fit",
        label: `Fit to screen (now ${Math.round(zoom * 100)}%)`,
        icon: <FitScreen fontSize="small" />,
        onClick: onFitToScreen,
      },
      onGridToggle && {
        key: "grid",
        label: gridVisible ? "Hide grid" : "Show grid",
        icon: gridVisible ? (
          <GridOffIcon fontSize="small" />
        ) : (
          <GridOnIcon fontSize="small" />
        ),
        onClick: onGridToggle,
      },
      onSnapToggle && {
        key: "snap",
        label: snapEnabled ? "Disable snap to grid" : "Enable snap to grid",
        icon: <FitScreen fontSize="small" />,
        onClick: onSnapToggle,
      },
      {
        key: "timer",
        label: "Personal meeting timer",
        icon: <TimerIcon fontSize="small" />,
        onClick: () => setTimerAnchor(moreButtonRef.current),
      },
      onPresentationMode && {
        key: "presentation",
        label: isPresentationMode ? "Exit presentation" : "Enter presentation",
        icon: <PresentToAll fontSize="small" />,
        onClick: onPresentationMode,
      },
      {
        key: "theme",
        label: themeMode === "light" ? "Dark mode" : "Light mode",
        icon:
          themeMode === "light" ? (
            <DarkModeIcon fontSize="small" />
          ) : (
            <LightModeIcon fontSize="small" />
          ),
        onClick: toggleTheme,
      },
      ...(onFollowUser
        ? collaborators.map((collaborator) => ({
            key: `follow-${collaborator.userId}`,
            label: `Follow ${collaborator.name || collaborator.email}`,
            icon: <FollowIcon fontSize="small" />,
            onClick: () => onFollowUser(collaborator.userId),
            selected: followingUserId === collaborator.userId,
          }))
        : []),
      onExport && {
        key: "export",
        label: "Export canvas",
        icon: <ExportIcon fontSize="small" />,
        onClick: onExport,
      },
      onVersionHistory && {
        key: "versions",
        label: "Version history",
        icon: <VersionHistoryIcon fontSize="small" />,
        onClick: onVersionHistory,
      },
    ].filter(Boolean) as MenuEntry[];

    return (
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar
          disableGutters
          sx={{ minHeight: 56, px: 0.5, gap: 0.5, overflow: "hidden" }}
        >
          <IconButton
            aria-label="Back to dashboard"
            onClick={handleBackClick}
            sx={tap}
          >
            <ArrowBack />
          </IconButton>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            {showSearch && onSearchChange ? (
              searchField
            ) : isEditingName ? (
              nameEditor
            ) : (
              <Typography
                variant="subtitle1"
                component="h1"
                noWrap
                title={canvasName}
                sx={{ fontWeight: 700, minWidth: 0 }}
              >
                {canvasName}
              </Typography>
            )}
            {saveDisplay && !showSearch && !isEditingName && (
              <Tooltip title={saveError || saveDisplay.tooltip}>
                <Box
                  role="status"
                  aria-label={`Save status: ${saveDisplay.label}`}
                  sx={{
                    width: 10,
                    height: 10,
                    flexShrink: 0,
                    borderRadius: "50%",
                    bgcolor: saveDotColor,
                  }}
                />
              </Tooltip>
            )}
          </Box>
          {canManageCanvas && (
            <IconButton
              aria-label="Share canvas"
              onClick={() => setShareDialogOpen(true)}
              sx={tap}
            >
              <ShareIcon />
            </IconButton>
          )}
          <IconButton
            ref={moreButtonRef}
            aria-label="More canvas options"
            aria-haspopup="menu"
            aria-expanded={Boolean(anchorEl)}
            onClick={handleMenuOpen}
            sx={tap}
          >
            <MoreVert />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
            slotProps={{ list: { "aria-label": "More canvas options" } }}
          >
            {showStatus && (
              <MenuItem disabled key="status" sx={{ opacity: "1 !important" }}>
                <ListItemIcon>
                  <OnlineIcon
                    fontSize="small"
                    sx={{ color: statusDisplay.iconColor }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={`Collaboration: ${statusDisplay.label}`}
                  secondary={saveDisplay?.label}
                />
              </MenuItem>
            )}
            {entries.map((entry) => (
              <MenuItem
                key={entry.key}
                selected={entry.selected}
                onClick={run(entry.onClick)}
              >
                <ListItemIcon>{entry.icon}</ListItemIcon>
                <ListItemText>{entry.label}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
          <MeetingTimer
            hideTrigger
            externalAnchor={timerAnchor}
            onExternalClose={() => setTimerAnchor(null)}
          />
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
            searchField
          ) : isEditingName ? (
            nameEditor
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
                            ? "2px solid"
                            : "1px solid",
                        borderColor:
                          followingUserId === collaborator.userId
                            ? "info.main"
                            : "background.paper",
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

        {saveStatus && (
          <Tooltip
            title={
              saveError ||
              describeSaveStatus(saveStatus, {
                offlineChanges,
                deviceCopyFailed,
              }).tooltip
            }
          >
            <Chip
              label={
                describeSaveStatus(saveStatus, {
                  offlineChanges,
                  deviceCopyFailed,
                }).label
              }
              size="small"
              color={
                saveStatus === "saved"
                  ? "success"
                  : saveStatus === "saving"
                    ? "info"
                    : saveStatus === "offline/retrying"
                      ? "warning"
                      : "error"
              }
              variant={saveStatus === "saved" ? "outlined" : "filled"}
              aria-label="Save status"
              sx={{ mr: 1, height: 24, fontSize: 11 }}
            />
          </Tooltip>
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

        {/* Secondary actions: inline on wide viewports, collapsed into
            one overflow menu below md so 320-768px stays usable. */}
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
