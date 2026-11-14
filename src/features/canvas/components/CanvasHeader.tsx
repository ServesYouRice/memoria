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
  Tooltip,
  Menu,
  MenuItem,
  ToggleButton,
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

import { useThemeMode } from "@/lib/theme-context";
import { MeetingTimer } from "./MeetingTimer";
import type { SharedTimerSnapshot } from "@/lib/hooks/use-collaboration";
import type { SharedTimerAction } from "@/lib/collaboration/shared-timer";
import { isArCanvasEnabled } from "@/lib/product-surfaces";
import { PresentToAll } from "@mui/icons-material";
import { zoomedIn, zoomedOut } from "./CanvasViewControls";
import { type CanvasSecondaryAction } from "@/features/canvas/components/CanvasSecondaryActions";

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
  /** IMP-105: the shared timer, and whether this person may control it. */
  timer?: SharedTimerSnapshot | null;
  onTimerCommand?: (action: SharedTimerAction, durationMs: number) => void;
  canControlTimer?: boolean;
}

/**
 * IMP-084: plain names for the two views, with what each one does. The saved
 * values stay "manual" and "organizer".
 */
export const VIEW_MODES = {
  manual: {
    label: "Free layout",
    tooltip: "Place notes, links and pictures anywhere on the canvas",
  },
  organizer: {
    label: "Organised list",
    tooltip:
      "See every item as a list you can sort, filter and use by keyboard",
  },
} as const;

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
  timer = null,
  onTimerCommand,
  canControlTimer = false,
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

  const handleZoomIn = () => onZoomChange(zoomedIn(zoom));
  const handleZoomOut = () => onZoomChange(zoomedOut(zoom));

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
            ? `Switch to ${VIEW_MODES.organizer.label}`
            : `Switch to ${VIEW_MODES.manual.label}`,
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
        label: "Shared timer",
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
            timer={timer}
            onCommand={onTimerCommand}
            canControl={canControlTimer}
            connected={collaborationConnected}
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

  // IMP-084: wide screens keep the title and the view switch on the left;
  // people present, Share and one labelled "More" menu sit on the right.
  // Zoom, fit, grid and snap live in the canvas corner (CanvasViewControls).
  const saveDisplay = saveStatus
    ? describeSaveStatus(saveStatus, { offlineChanges, deviceCopyFailed })
    : null;
  type MoreEntry = {
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    selected?: boolean;
  };
  const moreEntries: MoreEntry[] = [
    ...secondaryActions.map((action) => ({
      key: action.key,
      label: action.badgeCount
        ? `${action.label} (${action.badgeCount})`
        : action.label,
      icon: action.icon,
      onClick: action.onClick,
    })),
    {
      key: "timer",
      label: "Shared timer",
      icon: <TimerIcon fontSize="small" />,
      onClick: () => setTimerAnchor(moreButtonRef.current),
    },
    onPresentationMode && {
      key: "presentation",
      label: isPresentationMode ? "Exit presentation" : "Present",
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
  ].filter(Boolean) as MoreEntry[];

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar sx={{ minHeight: 64, gap: 1 }}>
        <Tooltip title="Back to dashboard">
          <IconButton
            aria-label="Back to dashboard"
            edge="start"
            onClick={handleBackClick}
          >
            <ArrowBack />
          </IconButton>
        </Tooltip>

        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          {showSearch && onSearchChange ? (
            searchField
          ) : isEditingName ? (
            nameEditor
          ) : (
            <>
              <Typography
                variant="h6"
                component="h1"
                noWrap
                title={canvasName}
                sx={{ cursor: "default", minWidth: 0 }}
              >
                {canvasName}
              </Typography>
              {canManageCanvas && (
                <Tooltip title="Rename canvas">
                  <IconButton
                    size="small"
                    aria-label={`Rename canvas ${canvasName}`}
                    onClick={handleNameClick}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {onViewModeChange && (
                <Box
                  role="group"
                  aria-label="Canvas view"
                  sx={{
                    display: "flex",
                    flexShrink: 0,
                    "& .MuiToggleButton-root": {
                      textTransform: "none",
                      px: 1.5,
                      py: 0.5,
                    },
                    "& > :first-of-type": {
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                    },
                    "& > :last-of-type": {
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      ml: "-1px",
                    },
                  }}
                >
                  {(["manual", "organizer"] as const).map((value) => (
                    <Tooltip key={value} title={VIEW_MODES[value].tooltip}>
                      <ToggleButton
                        value={value}
                        size="small"
                        selected={viewMode === value}
                        aria-pressed={viewMode === value}
                        onChange={() => {
                          if (viewMode !== value) onViewModeChange(value);
                        }}
                      >
                        {VIEW_MODES[value].label}
                      </ToggleButton>
                    </Tooltip>
                  ))}
                </Box>
              )}
            </>
          )}
        </Box>

        {saveDisplay && saveStatus && (
          <Tooltip title={saveError || saveDisplay.tooltip}>
            <Chip
              label={saveDisplay.label}
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
              sx={{ height: 24, fontSize: 11 }}
            />
          </Tooltip>
        )}

        {(collaborators.length > 0 || showStatus) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
                    "& .MuiChip-icon": { marginLeft: 0.5 },
                  }}
                />
              </Tooltip>
            )}
            {collaborators.length > 0 && (
              <AvatarGroup
                max={5}
                sx={{
                  "& .MuiAvatar-root": { width: 32, height: 32, fontSize: 14 },
                }}
              >
                {collaborators.map((collaborator) => {
                  const who = collaborator.name || collaborator.email;
                  const following = followingUserId === collaborator.userId;
                  return (
                    <Tooltip
                      key={collaborator.userId}
                      title={
                        onFollowUser
                          ? following
                            ? `Following ${who} (click to stop)`
                            : `${who} is here (click to follow)`
                          : `${who} is here`
                      }
                    >
                      <Avatar
                        component={onFollowUser ? "button" : "div"}
                        aria-label={
                          onFollowUser
                            ? following
                              ? `Stop following ${who}`
                              : `Follow ${who}`
                            : who
                        }
                        aria-pressed={onFollowUser ? following : undefined}
                        sx={{
                          bgcolor: collaborator.color,
                          width: 32,
                          height: 32,
                          p: 0,
                          fontSize: 14,
                          fontWeight: "bold",
                          cursor: onFollowUser ? "pointer" : "default",
                          border: following ? "2px solid" : "1px solid",
                          borderColor: following
                            ? "info.main"
                            : "background.paper",
                          boxSizing: "border-box",
                        }}
                        onClick={() =>
                          onFollowUser && onFollowUser(collaborator.userId)
                        }
                      >
                        {who.charAt(0).toUpperCase()}
                      </Avatar>
                    </Tooltip>
                  );
                })}
              </AvatarGroup>
            )}
          </Box>
        )}

        {canManageCanvas && (
          <Button
            variant="outlined"
            startIcon={<ShareIcon />}
            aria-label="Share canvas"
            onClick={() => setShareDialogOpen(true)}
            sx={{ flexShrink: 0 }}
          >
            Share
          </Button>
        )}

        <Tooltip title="More options">
          <IconButton
            ref={moreButtonRef}
            aria-label="More canvas options"
            aria-haspopup="menu"
            aria-expanded={Boolean(anchorEl)}
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
          slotProps={{ list: { "aria-label": "More canvas options" } }}
        >
          {moreEntries.map((entry) => (
            <MenuItem
              key={entry.key}
              selected={entry.selected}
              onClick={() => {
                handleMenuClose();
                entry.onClick();
              }}
            >
              <ListItemIcon>{entry.icon}</ListItemIcon>
              <ListItemText>{entry.label}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
        <MeetingTimer
          timer={timer}
          onCommand={onTimerCommand}
          canControl={canControlTimer}
          connected={collaborationConnected}
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
