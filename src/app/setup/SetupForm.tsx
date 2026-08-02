"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

interface SetupFormProps {
  needsToken: boolean;
}

export function SetupForm({ needsToken }: SetupFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isDisabled = useMemo(() => {
    if (needsToken && !token.trim()) {
      return true;
    }

    return !name.trim() || !email.trim() || !password.trim() || loading;
  }, [email, loading, name, needsToken, password, token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/setup/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, token }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.detail || payload?.message || "Bootstrap failed.",
        );
      }

      setSuccess(
        payload?.message || "Bootstrap complete. You can now sign in.",
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Bootstrap failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        width: "100%",
        maxWidth: 520,
        mx: "auto",
        p: 4,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
      }}
    >
      <Stack spacing={2}>
        <Typography variant="h4">Initial Setup</Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
          }}
        >
          Create the first owner account, the default Personal workspace, and
          the Inbox canvas.
        </Typography>

        {needsToken && (
          <TextField
            label="Bootstrap Token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            fullWidth
            type="password"
            autoComplete="new-password"
          />
        )}

        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          fullWidth
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          fullWidth
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          fullWidth
        />

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        <Button type="submit" variant="contained" disabled={isDisabled}>
          {loading ? "Setting up..." : "Create Owner Account"}
        </Button>
      </Stack>
    </Box>
  );
}
