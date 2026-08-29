/**
 * Share Dialog Component
 * Allows users to share canvas publicly or with specific people
 */

"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Alert,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Select,
  MenuItem,
  FormControl,
  Switch,
  FormControlLabel,
  InputAdornment,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Close, ContentCopy, Delete } from "@mui/icons-material";
import { ApiError, apiFetch } from "@/lib/api/fetch-client";
import { confirmDialog } from "@/stores/confirmStore";

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasName: string;
}

interface Share {
  id: string;
  email: string;
  role: "VIEW" | "COMMENT" | "EDIT";
  createdAt: string;
}

function formatShareError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const retry = error.retryAfterSeconds
      ? ` Try again in ${error.retryAfterSeconds} seconds.`
      : "";
    const request = error.requestId ? ` (Request ID: ${error.requestId})` : "";
    return `${error.message || fallback}${retry}${request}`;
  }
  return error instanceof Error ? error.message : fallback;
}

export function ShareDialog({
  open,
  onClose,
  canvasId,
  canvasName,
}: ShareDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const shareInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Public sharing
  const [isPublic, setIsPublic] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [rotatingLink, setRotatingLink] = useState(false);

  // Individual sharing
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VIEW" | "COMMENT" | "EDIT">("VIEW");
  const [shares, setShares] = useState<Share[]>([]);
  const [sharingWithUser, setSharingWithUser] = useState(false);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);

  // Load existing shares
  const loadShares = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}/share`);
      if (response.ok) {
        const data = await response.json();
        setShares(data.shares || []);
      }
    } catch (err) {
      setError(formatShareError(err, "Failed to load shares"));
    }
  }, [canvasId]);

  const checkPublicStatus = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}`);
      if (response.ok) {
        const canvas = await response.json();
        setIsPublic(canvas.isPublic || false);
        if (canvas.shareToken) {
          const url = `${window.location.origin}/share/${canvas.shareToken}`;
          setShareUrl(url);
        }
      }
    } catch (err) {
      setError(formatShareError(err, "Failed to check public status"));
    }
  }, [canvasId]);

  useEffect(() => {
    if (open) {
      loadShares();
      checkPublicStatus();
    }
  }, [open, loadShares, checkPublicStatus]);

  const handleTogglePublic = async () => {
    if (isPublic) {
      const confirmed = await confirmDialog({
        title: "Disable public link?",
        message:
          "The current URL will be permanently invalidated and cannot be restored.",
        confirmText: "Disable link",
        destructive: true,
      });
      if (!confirmed) return;
    }
    setGeneratingLink(true);
    setError(null);

    try {
      if (isPublic) {
        // Make private
        await apiFetch(`/api/v1/canvases/${canvasId}/public`, {
          method: "DELETE",
        });

        setIsPublic(false);
        setShareUrl(null);
        setSuccess("Canvas is now private");
      } else {
        // Make public
        const response = await apiFetch(`/api/v1/canvases/${canvasId}/public`, {
          method: "POST",
        });

        const data = await response.json();
        setIsPublic(true);
        setShareUrl(data.shareUrl);
        setSuccess("Public link generated!");
      }
    } catch (err) {
      setError(formatShareError(err, "Failed to update sharing settings"));
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setSuccess("Link copied to clipboard!");
        setError(null);
      } catch (err) {
        setError(formatShareError(err, "Clipboard access was denied"));
      }
    }
  };

  const handleRotateLink = async () => {
    const confirmed = await confirmDialog({
      title: "Rotate public link?",
      message: "The previous URL will be permanently invalidated.",
      confirmText: "Rotate link",
      destructive: true,
    });
    if (!confirmed) return;
    setRotatingLink(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}/public`, {
        method: "PUT",
      });
      const data = (await response.json()) as { shareUrl?: string };
      if (!data.shareUrl)
        throw new Error("The server did not return a share URL");
      setIsPublic(true);
      setShareUrl(data.shareUrl);
      setSuccess(
        "Public link rotated. The previous URL is permanently invalid.",
      );
    } catch (err) {
      setError(formatShareError(err, "Failed to rotate public link"));
    } finally {
      setRotatingLink(false);
    }
  };

  const handleShareWithUser = async () => {
    if (shareInFlightRef.current) return;
    if (!email.trim()) {
      setError("Please enter an email address");
      return;
    }

    shareInFlightRef.current = true;
    setSharingWithUser(true);
    setError(null);

    try {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });

      const data = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      setSuccess(
        data?.message ||
          "If the address can receive invitations, delivery has been queued.",
      );
      setEmail("");
      loadShares();
    } catch (err) {
      setError(formatShareError(err, "Failed to share canvas"));
    } finally {
      shareInFlightRef.current = false;
      setSharingWithUser(false);
    }
  };

  const handleRevokeShare = async (shareId: string, shareEmail: string) => {
    const confirmed = await confirmDialog({
      title: "Revoke canvas access?",
      message: `${shareEmail} will no longer be able to open this canvas.`,
      confirmText: "Revoke access",
      destructive: true,
    });
    if (!confirmed) return;
    setRevokingShareId(shareId);
    setError(null);
    try {
      await apiFetch(`/api/v1/canvases/${canvasId}/share/${shareId}`, {
        method: "DELETE",
      });

      setSuccess(`Access revoked for ${shareEmail}`);
      loadShares();
    } catch (err) {
      setError(formatShareError(err, "Failed to revoke share"));
    } finally {
      setRevokingShareId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="share-dialog-title"
    >
      <DialogTitle id="share-dialog-visual-title" sx={{ pr: 7 }}>
        <span id="share-dialog-title">
          Share <span aria-hidden="true">&quot;</span>
          {canvasName}
          <span aria-hidden="true">&quot;</span>
        </span>
        <IconButton
          onClick={onClose}
          aria-label="Close share dialog"
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Success/Error Messages */}
          {success && (
            <Alert severity="success" onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Public Link Section */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={isPublic}
                  onChange={() => void handleTogglePublic()}
                  disabled={generatingLink || rotatingLink}
                />
              }
              label="Anyone with the link can view"
            />
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
                ml: 4,
              }}
            >
              Public links are view-only
            </Typography>

            <Alert severity="info" sx={{ mt: 1 }}>
              Disabling sharing or rotating this link permanently invalidates
              the old URL.
            </Alert>

            {isPublic && shareUrl && (
              <TextField
                value={shareUrl}
                fullWidth
                size="small"
                sx={{ mt: 2 }}
                slotProps={{
                  htmlInput: { "aria-label": "Public share link" },
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={handleCopyLink}
                          edge="end"
                          aria-label="Copy public link"
                        >
                          <ContentCopy />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
            {isPublic && (
              <Button
                variant="outlined"
                onClick={() => void handleRotateLink()}
                disabled={rotatingLink || generatingLink}
                sx={{ mt: 1 }}
              >
                {rotatingLink ? "Rotating…" : "Rotate public link"}
              </Button>
            )}
          </Box>

          {/* Share with Specific People */}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Share with specific people
            </Typography>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                gap: 1,
                mb: 2,
              }}
            >
              <TextField
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                type="email"
                label="Email address"
                size="small"
                fullWidth
                disabled={sharingWithUser}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleShareWithUser();
                  }
                }}
              />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <Select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "VIEW" | "COMMENT" | "EDIT")
                  }
                  disabled={sharingWithUser}
                  inputProps={{ "aria-label": "Canvas access role" }}
                >
                  <MenuItem value="VIEW">View</MenuItem>
                  <MenuItem value="COMMENT">Comment</MenuItem>
                  <MenuItem value="EDIT">Edit</MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="contained"
                onClick={handleShareWithUser}
                disabled={sharingWithUser}
                sx={{ minWidth: 80 }}
              >
                {sharingWithUser ? <CircularProgress size={20} /> : "Share"}
              </Button>
            </Box>

            {/* List of shared users */}
            {shares.length > 0 && (
              <List dense>
                {shares.map((share) => (
                  <ListItem key={share.id}>
                    <ListItemText
                      primary={share.email}
                      secondary={`Can ${share.role.toLowerCase()}`}
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        aria-label={`Revoke access for ${share.email}`}
                        onClick={() =>
                          void handleRevokeShare(share.id, share.email)
                        }
                        disabled={revokingShareId !== null}
                      >
                        <Delete />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
