'use client';

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/hooks/use-api-keys';

export default function ApiKeysPage() {
  const { data, isLoading, error } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const keys = data?.keys ?? [];

  const handleCreate = async () => {
    try {
      const expiresAtIso = expiresAt ? new Date(expiresAt).toISOString() : null;
      const result = await createApiKey.mutateAsync({ name: newKeyName.trim(), expiresAt: expiresAtIso });
      setCreatedKey(result.plaintextKey);
      setNewKeyName('');
      setExpiresAt('');
      setCreateOpen(false);
    } catch {
      // handled by mutation state
    }
  };

  const statusForKey = (key: (typeof keys)[number]) => {
    if (key.revokedAt) return { label: 'Revoked', color: 'default' as const };
    if (key.expiresAt && new Date(key.expiresAt) <= new Date()) {
      return { label: 'Expired', color: 'warning' as const };
    }
    return { label: 'Active', color: 'success' as const };
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 960, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>API Keys</Typography>
          <Typography variant="body2" color="text.secondary">
            Create keys for extensions and webhooks. Keep them secret.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setCreateOpen(true)}>
          Create API Key
        </Button>
      </Box>

      {error && <Alert severity="error">Failed to load API keys</Alert>}

      {isLoading ? (
        <Typography color="text.secondary">Loading API keys...</Typography>
      ) : keys.length === 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography>No API keys yet.</Typography>
            <Typography variant="body2" color="text.secondary">
              Create a key to connect browser extensions or webhooks.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {keys.map((key) => {
            const status = statusForKey(key);
            return (
              <Card key={key.id} variant="outlined">
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h6">{key.name}</Typography>
                    <Chip size="small" label={status.label} color={status.color} />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {key.keyPreview ?? 'Key preview unavailable'}
                  </Typography>
                  <Divider />
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Created: {new Date(key.createdAt).toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Last used: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Expires: {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                    </Typography>
                  </Box>
                  <Box>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      disabled={!!key.revokedAt || revokeApiKey.isPending}
                      onClick={() => revokeApiKey.mutate({ keyId: key.id })}
                    >
                      Revoke
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create API Key</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Key name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g. Browser extension"
            fullWidth
          />
          <TextField
            label="Expires on (optional)"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <Alert severity="info">
            The full key is shown only once. Store it safely.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!newKeyName.trim() || createApiKey.isPending}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!createdKey} onClose={() => setCreatedKey(null)} fullWidth maxWidth="sm">
        <DialogTitle>API Key Created</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Alert severity="warning">Copy this key now — it won’t be shown again.</Alert>
          <TextField
            value={createdKey ?? ''}
            fullWidth
            InputProps={{
              readOnly: true,
              endAdornment: (
                <Button
                  startIcon={<CopyIcon />}
                  onClick={() => createdKey && navigator.clipboard.writeText(createdKey)}
                >
                  Copy
                </Button>
              ),
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreatedKey(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
