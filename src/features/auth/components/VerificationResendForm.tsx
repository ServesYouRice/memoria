"use client";

import { useState } from "react";
import { Alert, Box, Button, TextField } from "@mui/material";

interface VerificationResendFormProps {
  initialEmail?: string;
  compact?: boolean;
}

/**
 * Verification resend deliberately shows the API's generic response. The
 * server never confirms whether the submitted address belongs to an account.
 */
export function VerificationResendForm({
  initialEmail = "",
  compact = false,
}: VerificationResendFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/v1/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => null)) as {
        message?: string;
        detail?: string;
      } | null;

      if (!response.ok) {
        setError(data?.detail || "Unable to request a verification message.");
        return;
      }

      setMessage(
        data?.message ||
          "If an unverified account exists for that email, a verification message has been sent.",
      );
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Box component="section" aria-label="Resend verification email">
      {!compact && (
        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          fullWidth
          size="small"
          autoComplete="email"
          disabled={pending}
          sx={{ mb: 1.5 }}
        />
      )}
      {compact && (
        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          fullWidth
          size="small"
          autoComplete="email"
          disabled={pending}
          sx={{ mb: 1.5 }}
        />
      )}
      <Button
        type="button"
        variant="outlined"
        onClick={submit}
        disabled={pending || !email.trim()}
        fullWidth
      >
        {pending ? "Sending…" : "Resend verification email"}
      </Button>
      {message && (
        <Alert severity="success" sx={{ mt: 1.5 }}>
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
