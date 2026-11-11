"use client";

import React, { useState } from "react";
import { toast } from "sonner";
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
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  ContentCopy as CopyIcon,
  Add as AddIcon,
  KeyOutlined as KeyIcon,
} from "@mui/icons-material";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/lib/hooks/use-api-keys";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ApiError } from "@/lib/api/fetch-client";

/**
 * The end of a date input's day (YYYY-MM-DD) in the viewer's local time zone.
 * `new Date("YYYY-MM-DD")` reads the value as UTC midnight, which expires the
 * key at the start of the chosen day (or the day before, west of UTC).
 */
export function localEndOfDayIso(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(
    year as number,
    (month as number) - 1,
    day as number,
    23,
    59,
    59,
    999,
  ).toISOString();
}

/** A local calendar date formatted for a date input's value or min. */
export function localDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ApiKeysContent() {
  const { data, isLoading, error } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const keys = data?.keys ?? [];

  const handleCreate = async () => {
    try {
      const expiresAtIso = expiresAt ? localEndOfDayIso(expiresAt) : null;
      const result = await createApiKey.mutateAsync({
        name: newKeyName.trim(),
        expiresAt: expiresAtIso,
      });
      setCreatedKey(result.plaintextKey);
      setNewKeyName("");
      setExpiresAt("");
      setCreateOpen(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status < 500 && error.message
          ? error.message
          : "Failed to create API key",
      );
    }
  };

  const handleRevoke = (keyId: string) => {
    revokeApiKey.mutate(
      { keyId },
      {
        onSuccess: () => toast.success("API key revoked"),
        onError: () => toast.error("Failed to revoke API key"),
      },
    );
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    toast.success("API key copied to clipboard");
  };

  const statusForKey = (key: (typeof keys)[number]) => {
    if (key.revokedAt) return { label: "Revoked", color: "default" as const };
    if (key.expiresAt && new Date(key.expiresAt) <= new Date()) {
      return { label: "Expired", color: "warning" as const };
    }
    return { label: "Active", color: "success" as const };
  };

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle="Create keys for browser extensions and webhooks. Keep them secret."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
          >
            Create API key
          </Button>
        }
      />

      {error && <Alert severity="error">Failed to load API keys</Alert>}

      {isLoading && (
        <Stack spacing={2}>
          {[0, 1].map((i) => (
            <Card key={i} variant="outlined">
              <CardContent>
                <Skeleton width="40%" height={28} />
                <Skeleton width="60%" height={18} />
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {!isLoading && !error && keys.length === 0 && (
        <EmptyState
          icon={KeyIcon}
          title="No API keys yet"
          description="Create a key to connect browser extensions or webhooks to your account."
          action={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateOpen(true)}
            >
              Create API key
            </Button>
          }
        />
      )}

      {!isLoading && keys.length > 0 && (
        <Stack spacing={2}>
          {keys.map((key) => {
            const status = statusForKey(key);
            return (
              <Card key={key.id} variant="outlined">
                <CardContent
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: { xs: "flex-start", sm: "center" },
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 2,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 0.5,
                      }}
                    >
                      <Typography
                        variant="subtitle1"
                        noWrap
                        sx={{
                          fontWeight: 600,
                        }}
                      >
                        {key.name}
                      </Typography>
                      <Chip
                        size="small"
                        label={status.label}
                        color={status.color}
                      />
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        fontFamily: "monospace",
                      }}
                    >
                      {key.keyPreview ?? "Key preview unavailable"}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                      }}
                    >
                      Created {new Date(key.createdAt).toLocaleDateString()} •
                      Last used{" "}
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleString()
                        : "never"}{" "}
                      • Expires{" "}
                      {key.expiresAt
                        ? new Date(key.expiresAt).toLocaleDateString()
                        : "never"}
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    disabled={!!key.revokedAt || revokeApiKey.isPending}
                    onClick={() => handleRevoke(key.id)}
                    sx={{ flexShrink: 0 }}
                  >
                    Revoke
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Create API key</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
        >
          <TextField
            label="Key name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g. Browser extension"
            fullWidth
            autoFocus
          />
          <TextField
            label="Expires on (optional)"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: localDateInputValue(new Date()) },
            }}
            fullWidth
          />
          <Alert severity="info">
            The full key is shown only once. Store it safely.
          </Alert>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!newKeyName.trim() || createApiKey.isPending}
          >
            {createApiKey.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Created key dialog */}
      <Dialog
        open={!!createdKey}
        onClose={() => setCreatedKey(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 600 }}>API key created</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
        >
          <Alert severity="warning">
            Copy this key now — it won’t be shown again.
          </Alert>
          <TextField
            value={createdKey ?? ""}
            fullWidth
            slotProps={{
              input: {
                readOnly: true,
                sx: { fontFamily: "monospace" },
                endAdornment: (
                  <Button startIcon={<CopyIcon />} onClick={handleCopy}>
                    Copy
                  </Button>
                ),
              },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button variant="contained" onClick={() => setCreatedKey(null)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
