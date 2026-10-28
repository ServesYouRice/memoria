"use client";

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import SmartToyIcon from "@mui/icons-material/SmartToy";

interface ConsentFormProps {
  ticket: string;
  clientName: string;
  redirectHost: string;
  canvases: Array<{ id: string; name: string }>;
}

const ALWAYS_ALLOWED = [
  "Read and search the boards you pick below",
  "Save new links and notes to your Inbox",
  "Comment on items",
  "Suggest changes that wait for your approval",
];

export function ConsentForm({
  ticket,
  clientName,
  redirectHost,
  canvases,
}: ConsentFormProps) {
  const [selected, setSelected] = useState<string[]>(
    canvases.map((canvas) => canvas.id),
  );
  const [allowDirectWrites, setAllowDirectWrites] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(canvasId: string) {
    setSelected((current) =>
      current.includes(canvasId)
        ? current.filter((id) => id !== canvasId)
        : [...current, canvasId],
    );
  }

  async function decide(approve: boolean) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket,
          approve,
          canvasIds: selected,
          allowDirectWrites,
        }),
      });
      const body = (await response.json()) as {
        redirectTo?: string;
        error_description?: string;
        detail?: string;
      };
      if (!response.ok || !body.redirectTo) {
        throw new Error(
          body.error_description || body.detail || "Something went wrong.",
        );
      }
      window.location.assign(body.redirectTo);
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "Something went wrong.",
      );
      setPending(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3.5 }, borderRadius: 3 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2 }}>
        <SmartToyIcon color="primary" />
        <Typography variant="h6" component="h1" sx={{ fontWeight: 700 }}>
          Allow {clientName} to use Memoria?
        </Typography>
      </Stack>

      <Alert severity="info" sx={{ mb: 2.5 }}>
        Only continue if you started this from <strong>{redirectHost}</strong>.
        You can turn this access off any time in Settings.
      </Alert>

      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        It will be able to
      </Typography>
      <Box component="ul" sx={{ mt: 0, mb: 2.5, pl: 2.5 }}>
        {ALWAYS_ALLOWED.map((line) => (
          <Typography component="li" variant="body2" key={line}>
            {line}
          </Typography>
        ))}
      </Box>

      <FormControlLabel
        control={
          <Switch
            id="oauth-allow-direct-writes"
            checked={allowDirectWrites}
            onChange={(event) => setAllowDirectWrites(event.target.checked)}
          />
        }
        label="Also let it add and rearrange items without asking (you can still undo)"
        sx={{ mb: 2 }}
      />

      <Divider sx={{ mb: 2 }} />

      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Boards it may use
      </Typography>
      {canvases.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You have no boards yet. Create one first.
        </Alert>
      ) : (
        <FormGroup sx={{ mb: 2, maxHeight: 280, overflowY: "auto" }}>
          {canvases.map((canvas) => (
            <FormControlLabel
              key={canvas.id}
              control={
                <Checkbox
                  id={`oauth-canvas-${canvas.id}`}
                  checked={selected.includes(canvas.id)}
                  onChange={() => toggle(canvas.id)}
                />
              }
              label={canvas.name}
            />
          ))}
        </FormGroup>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
        <Button
          variant="text"
          disabled={pending}
          onClick={() => void decide(false)}
        >
          Deny
        </Button>
        <Button
          variant="contained"
          disabled={pending || selected.length === 0}
          onClick={() => void decide(true)}
        >
          Allow access
        </Button>
      </Stack>
    </Paper>
  );
}
