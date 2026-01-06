/**
 * Share Dialog Component
 * Allows users to share canvas publicly or with specific people
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
} from '@mui/material';
import { Close, ContentCopy, Delete } from '@mui/icons-material';

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasName: string;
}

interface Share {
  id: string;
  email: string;
  role: 'VIEW' | 'COMMENT' | 'EDIT';
  createdAt: string;
}

export function ShareDialog({ open, onClose, canvasId, canvasName }: ShareDialogProps) {

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Public sharing
  const [isPublic, setIsPublic] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);

  // Individual sharing
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'VIEW' | 'COMMENT' | 'EDIT'>('VIEW');
  const [shares, setShares] = useState<Share[]>([]);
  const [sharingWithUser, setSharingWithUser] = useState(false);

  // Load existing shares
  const loadShares = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/canvases/${canvasId}/share`);
      if (response.ok) {
        const data = await response.json();
        setShares(data.shares || []);
      }
    } catch (err) {
      console.error('Failed to load shares:', err);
    }
  }, [canvasId]);

  const checkPublicStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/canvases/${canvasId}`);
      if (response.ok) {
        const canvas = await response.json();
        setIsPublic(canvas.isPublic || false);
        if (canvas.shareToken) {
          const url = `${window.location.origin}/share/${canvas.shareToken}`;
          setShareUrl(url);
        }
      }
    } catch (err) {
      console.error('Failed to check public status:', err);
    }
  }, [canvasId]);

  useEffect(() => {
    if (open) {
      loadShares();
      checkPublicStatus();
    }
  }, [open, loadShares, checkPublicStatus]);

  const handleTogglePublic = async () => {
    setGeneratingLink(true);
    setError(null);

    try {
      if (isPublic) {
        // Make private
        const response = await fetch(`/api/v1/canvases/${canvasId}/public`, {
          method: 'DELETE',
        });

        if (!response.ok) throw new Error('Failed to make canvas private');

        setIsPublic(false);
        setSuccess('Canvas is now private');
      } else {
        // Make public
        const response = await fetch(`/api/v1/canvases/${canvasId}/public`, {
          method: 'POST',
        });

        if (!response.ok) throw new Error('Failed to generate share link');

        const data = await response.json();
        setIsPublic(true);
        setShareUrl(data.shareUrl);
        setSuccess('Public link generated!');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update sharing settings');
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setSuccess('Link copied to clipboard!');
    }
  };

  const handleShareWithUser = async () => {
    if (!email.trim()) {
      setError('Please enter an email address');
      return;
    }

    setSharingWithUser(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/canvases/${canvasId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to share canvas');
      }

      setSuccess(`Canvas shared with ${email}`);
      setEmail('');
      loadShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share canvas');
    } finally {
      setSharingWithUser(false);
    }
  };

  const handleRevokeShare = async (shareId: string, shareEmail: string) => {
    try {
      const response = await fetch(`/api/v1/canvases/${canvasId}/share/${shareId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to revoke share');

      setSuccess(`Access revoked for ${shareEmail}`);
      loadShares();
    } catch {
      setError('Failed to revoke share');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Share &quot;{canvasName}&quot;
        <IconButton
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                  onChange={handleTogglePublic}
                  disabled={generatingLink}
                />
              }
              label="Anyone with the link can view"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
              Public links are view-only
            </Typography>

            {isPublic && shareUrl && (
              <TextField
                value={shareUrl}
                fullWidth
                size="small"
                sx={{ mt: 2 }}
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={handleCopyLink} edge="end">
                        <ContentCopy />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            )}
          </Box>

          {/* Share with Specific People */}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Share with specific people
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                size="small"
                fullWidth
                disabled={sharingWithUser}
              />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <Select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'VIEW' | 'COMMENT' | 'EDIT')}
                  disabled={sharingWithUser}
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
                {sharingWithUser ? <CircularProgress size={20} /> : 'Share'}
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
                        onClick={() => handleRevokeShare(share.id, share.email)}
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
