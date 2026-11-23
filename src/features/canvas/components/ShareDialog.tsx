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
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  Paper,
  Select,
  MenuItem,
  FormControl,
  Switch,
  FormControlLabel,
  InputAdornment,
  useMediaQuery,
  useTheme,
  alpha,
} from "@mui/material";
import { Check, Close, ContentCopy, Delete } from "@mui/icons-material";
import { motion } from "@/lib/theme";
import { ApiError, apiFetch } from "@/lib/api/fetch-client";
import { confirmDialog } from "@/stores/confirmStore";
import { EmbedManager } from "./EmbedManager";

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

interface PendingInvitation {
  id: string;
  email: string;
  role: "VIEW" | "COMMENT" | "EDIT";
  expiresAt: string;
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
  const [publicStatusLoading, setPublicStatusLoading] = useState(false);
  // Bumped by every public-link change and by closing the dialog, so a status
  // response that was requested before either never overwrites newer state.
  const publicStateEpochRef = useRef(0);

  // Individual sharing
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VIEW" | "COMMENT" | "EDIT">("VIEW");
  const [shares, setShares] = useState<Share[]>([]);
  // Sharing by email sends an invitation; it stays here until it is answered.
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [sharingWithUser, setSharingWithUser] = useState(false);
  // IMP-145: where mail is not set up, the server hands back the link.
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<"public" | "invite" | null>(
    null,
  );
  const copyTimerRef = useRef<number | null>(null);

  const flashCopied = (target: "public" | "invite") => {
    setCopiedTarget(target);
    if (copyTimerRef.current !== null)
      window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedTarget(null), 2000);
  };

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // Load existing shares
  const loadShares = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}/share`);
      if (response.ok) {
        const data = await response.json();
        setShares(data.shares || []);
        setInvitations(data.invitations || []);
      }
    } catch (err) {
      setError(formatShareError(err, "Failed to load shares"));
    }
  }, [canvasId]);

  const checkPublicStatus = useCallback(async () => {
    const epoch = publicStateEpochRef.current;
    setPublicStatusLoading(true);
    try {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}`);
      if (response.ok) {
        const canvas = await response.json();
        if (epoch !== publicStateEpochRef.current) return;
        setIsPublic(canvas.isPublic || false);
        if (canvas.shareToken) {
          const url = `${window.location.origin}/share/${canvas.shareToken}`;
          setShareUrl(url);
        }
      }
    } catch (err) {
      if (epoch !== publicStateEpochRef.current) return;
      setError(formatShareError(err, "Failed to check public status"));
    } finally {
      if (epoch === publicStateEpochRef.current) setPublicStatusLoading(false);
    }
  }, [canvasId]);

  useEffect(() => {
    if (open) {
      loadShares();
      checkPublicStatus();
    } else {
      publicStateEpochRef.current += 1;
      setPublicStatusLoading(false);
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
    publicStateEpochRef.current += 1;
    setPublicStatusLoading(false);
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
        flashCopied("public");
        setSuccess("Link copied to clipboard!");
        setError(null);
      } catch (err) {
        setError(formatShareError(err, "Clipboard access was denied"));
      }
    }
  };

  const handleCopyInvitation = async () => {
    if (!invitationUrl) return;
    try {
      await navigator.clipboard.writeText(invitationUrl);
      flashCopied("invite");
      setSuccess("Invitation link copied");
      setError(null);
    } catch (err) {
      setError(formatShareError(err, "Clipboard access was denied"));
    }
  };

  const handleRotateLink = async () => {
    const confirmed = await confirmDialog({
      title: "Make a new link?",
      message: "The previous URL will be permanently invalidated.",
      confirmText: "Make a new link",
      destructive: true,
    });
    if (!confirmed) return;
    publicStateEpochRef.current += 1;
    setPublicStatusLoading(false);
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
      setSuccess("New link made. The old link no longer works.");
    } catch (err) {
      setError(formatShareError(err, "Could not make a new link"));
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
        invitationUrl?: string;
      } | null;
      setInvitationUrl(data?.invitationUrl ?? null);
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

  const handleRevokeInvitation = async (
    invitationId: string,
    invitationEmail: string,
  ) => {
    const confirmed = await confirmDialog({
      title: "Revoke invitation?",
      message: `The invitation sent to ${invitationEmail} will stop working.`,
      confirmText: "Revoke invitation",
      destructive: true,
    });
    if (!confirmed) return;
    setRevokingShareId(invitationId);
    setError(null);
    try {
      await apiFetch(`/api/v1/canvases/${canvasId}/share/${invitationId}`, {
        method: "DELETE",
      });
      setSuccess(`Invitation revoked for ${invitationEmail}`);
    } catch (err) {
      // A conflict means the invitation was answered meanwhile; the reload
      // below moves an accepted invitee into the collaborator list.
      setError(formatShareError(err, "Failed to revoke invitation"));
    } finally {
      setRevokingShareId(null);
      loadShares();
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
          {invitationUrl && (
            <TextField
              fullWidth
              size="small"
              label="Invitation link"
              value={invitationUrl}
              helperText="Only the invited address can use it. It expires in 7 days."
              slotProps={{
                input: {
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={handleCopyInvitation}
                        edge="end"
                        aria-label="Copy invitation link"
                        color={
                          copiedTarget === "invite" ? "success" : "default"
                        }
                      >
                        {copiedTarget === "invite" ? (
                          <Check
                            sx={{
                              animation: `checkPop 220ms ${motion.springSnappy}`,
                            }}
                          />
                        ) : (
                          <ContentCopy />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Public Link Section */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              borderRadius: 3,
              bgcolor: (theme) =>
                isPublic
                  ? alpha(theme.palette.primary.main, 0.04)
                  : "action.hover",
              borderColor: isPublic ? "primary.main" : "divider",
              transition: `border-color 180ms ${motion.easeOut}, background-color 180ms ${motion.easeOut}`,
            }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={isPublic}
                  onChange={() => void handleTogglePublic()}
                  disabled={
                    generatingLink || rotatingLink || publicStatusLoading
                  }
                />
              }
              label={
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Anyone with the link can view
                </Typography>
              }
            />
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
                ml: 5.5,
              }}
            >
              Public links are view-only. Turning sharing off invalidates the
              URL.
            </Typography>

            {isPublic && shareUrl && (
              <TextField
                value={shareUrl}
                fullWidth
                size="small"
                sx={{ mt: 2, bgcolor: "background.paper", borderRadius: 2 }}
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
                          color={
                            copiedTarget === "public" ? "success" : "default"
                          }
                        >
                          {copiedTarget === "public" ? (
                            <Check
                              sx={{
                                animation: `checkPop 220ms ${motion.springSnappy}`,
                              }}
                            />
                          ) : (
                            <ContentCopy />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
            {isPublic && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 1,
                  mt: 1.5,
                }}
              >
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Making a new link stops the old URL from working.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void handleRotateLink()}
                  disabled={
                    rotatingLink || generatingLink || publicStatusLoading
                  }
                >
                  {rotatingLink ? "Making a new link…" : "Make a new link"}
                </Button>
              </Box>
            )}
          </Paper>

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
                  <ListItem key={share.id} sx={{ px: 0.5 }}>
                    <ListItemAvatar sx={{ minWidth: 42 }}>
                      <Avatar
                        sx={{
                          width: 30,
                          height: 30,
                          fontSize: 13,
                          fontWeight: 700,
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                        }}
                      >
                        {share.email.charAt(0).toUpperCase()}
                      </Avatar>
                    </ListItemAvatar>
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

            {invitations.length > 0 && (
              <>
                <Typography
                  variant="subtitle2"
                  sx={{ mt: 1, color: "text.secondary" }}
                >
                  Pending invitations
                </Typography>
                <List dense aria-label="Pending invitations">
                  {invitations.map((invitation) => (
                    <ListItem key={invitation.id} sx={{ px: 0.5 }}>
                      <ListItemAvatar sx={{ minWidth: 42 }}>
                        <Avatar
                          sx={{
                            width: 30,
                            height: 30,
                            fontSize: 13,
                            fontWeight: 700,
                            bgcolor: "action.selected",
                            color: "text.primary",
                          }}
                        >
                          {invitation.email.charAt(0).toUpperCase()}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={invitation.email}
                        secondary={`Invited to ${invitation.role.toLowerCase()}`}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          aria-label={`Revoke invitation for ${invitation.email}`}
                          onClick={() =>
                            void handleRevokeInvitation(
                              invitation.id,
                              invitation.email,
                            )
                          }
                          disabled={revokingShareId !== null}
                        >
                          <Delete />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </Box>

          {/* Signed read-only embeds for other sites */}
          <EmbedManager canvasId={canvasId} />
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
