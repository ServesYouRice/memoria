/**
 * Embed Manager
 * Owner UI to create, list, and revoke signed read-only embeds of a canvas.
 * The server enforces ownership and validation; this form only gives early
 * feedback.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { ContentCopy } from "@mui/icons-material";
import { ApiError, apiFetch } from "@/lib/api/fetch-client";
import { confirmDialog } from "@/stores/confirmStore";
import { normalizeEmbedOrigins } from "@/lib/embeds/origins";

interface EmbedSummary {
  id: string;
  label: string;
  allowedOrigins: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

function embedStatus(embed: EmbedSummary): "Active" | "Revoked" | "Expired" {
  if (embed.revokedAt) return "Revoked";
  if (new Date(embed.expiresAt) <= new Date()) return "Expired";
  return "Active";
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error
    ? error.message || fallback
    : fallback;
}

export interface EmbedManagerProps {
  canvasId: string;
}

export function EmbedManager({ canvasId }: EmbedManagerProps) {
  const endpoint = `/api/v1/canvases/${canvasId}/embeds`;
  const [embeds, setEmbeds] = useState<EmbedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [origins, setOrigins] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ embedUrl: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(endpoint);
      const data = (await response.json()) as { embeds: EmbedSummary[] };
      setEmbeds(data.embeds);
    } catch (err) {
      setError(messageFor(err, "Failed to load embeds"));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const entries = origins
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!normalizeEmbedOrigins(entries)) {
      setError(
        "Enter one or more exact https origins, such as https://example.com (no paths or wildcards).",
      );
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, allowedOrigins: entries }),
      });
      const data = (await response.json()) as { embedUrl: string };
      setCreated({ embedUrl: data.embedUrl });
      setLabel("");
      setOrigins("");
      await load();
    } catch (err) {
      setError(messageFor(err, "Failed to create embed"));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (embed: EmbedSummary) => {
    const confirmed = await confirmDialog({
      title: "Revoke embed?",
      message:
        "Sites using this embed will stop showing the canvas immediately.",
      confirmText: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;

    setError(null);
    try {
      await apiFetch(`${endpoint}/${embed.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(messageFor(err, "Failed to revoke embed"));
    }
  };

  const handleCopy = async () => {
    if (created) await navigator.clipboard.writeText(created.embedUrl);
  };

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Embed on other sites
      </Typography>
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", display: "block", mb: 1 }}
      >
        Embeds are read-only and can only be framed by the origins you list.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      {created && (
        <Alert
          severity="success"
          onClose={() => setCreated(null)}
          sx={{ mb: 1 }}
        >
          Copy this embed URL now. It is shown only once.
          <TextField
            value={created.embedUrl}
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            slotProps={{
              htmlInput: { "aria-label": "Embed URL" },
              input: {
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => void handleCopy()}
                      edge="end"
                      aria-label="Copy embed URL"
                    >
                      <ContentCopy />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Alert>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1 }}>
        <TextField
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          label="Embed label"
          size="small"
          fullWidth
          disabled={creating}
          slotProps={{ htmlInput: { maxLength: 100 } }}
        />
        <TextField
          value={origins}
          onChange={(event) => setOrigins(event.target.value)}
          label="Allowed origins"
          placeholder="https://example.com"
          helperText="Separate multiple origins with spaces or commas."
          size="small"
          fullWidth
          disabled={creating}
        />
        <Button
          variant="outlined"
          onClick={() => void handleCreate()}
          disabled={creating || origins.trim() === ""}
          sx={{ alignSelf: "flex-start" }}
        >
          {creating ? <CircularProgress size={20} /> : "Create embed"}
        </Button>
      </Box>

      {loading ? (
        <CircularProgress size={20} />
      ) : (
        embeds.length > 0 && (
          <List dense aria-label="Embeds">
            {embeds.map((embed) => {
              const status = embedStatus(embed);
              return (
                <ListItem
                  key={embed.id}
                  secondaryAction={
                    status === "Active" ? (
                      <Button
                        size="small"
                        color="error"
                        onClick={() => void handleRevoke(embed)}
                        aria-label={`Revoke embed ${embed.label || embed.id}`}
                      >
                        Revoke
                      </Button>
                    ) : undefined
                  }
                >
                  <ListItemText
                    primary={
                      <>
                        {embed.label || "Untitled embed"}{" "}
                        <Chip
                          size="small"
                          label={status}
                          color={status === "Active" ? "success" : "default"}
                        />
                      </>
                    }
                    secondary={`${embed.allowedOrigins.join(", ")} · expires ${new Date(
                      embed.expiresAt,
                    ).toLocaleDateString()}`}
                  />
                </ListItem>
              );
            })}
          </List>
        )
      )}
    </Box>
  );
}
