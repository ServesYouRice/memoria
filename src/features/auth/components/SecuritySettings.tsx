"use client";

/**
 * Passkeys, authenticator-app two-factor, and session revocation (IMP-041).
 *
 * Every action calls a Better Auth endpoint that re-checks the session (and
 * the password where it changes a factor); this UI is not the boundary.
 */

import { DisabledReason } from "@/components/DisabledReason";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Delete as DeleteIcon,
  Fingerprint as FingerprintIcon,
  PhonelinkLock as AuthenticatorIcon,
  Logout as LogoutIcon,
} from "@mui/icons-material";
import { authClient } from "@/lib/auth-client";

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
}

interface Enrolment {
  secret: string;
  totpURI: string;
  backupCodes: string[];
}

type ErrorLike = { message?: string } | null | undefined;

function failure(error: ErrorLike, fallback: string): string {
  return error?.message || fallback;
}

function secretFromUri(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function SecuritySettings({
  twoFactorEnabled,
  hasPassword = true,
}: {
  twoFactorEnabled: boolean;
  /** False for someone who only signs in with a login system (IMP-099). */
  hasPassword?: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(twoFactorEnabled);
  const [password, setPassword] = useState("");
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Without a password there is nothing to confirm with; the server still
  // asks anyone who has one (allowPasswordless only skips password-less
  // accounts).
  const confirmation = hasPassword ? { password } : {};
  const needsPassword = hasPassword && !password;

  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [passkeyName, setPasskeyName] = useState("");

  const loadPasskeys = useCallback(async () => {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) {
      toast.error(failure(error, "Could not load passkeys"));
      return;
    }
    setPasskeys((data as PasskeyRow[] | null) ?? []);
  }, []);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  const startEnrolment = async () => {
    setBusy(true);
    try {
      const { data, error } = await authClient.twoFactor.enable(confirmation);
      if (error || !data || !("totpURI" in data) || !data.totpURI) {
        toast.error(failure(error, "Could not start two-factor setup"));
        return;
      }
      setEnrolment({
        totpURI: data.totpURI,
        secret: secretFromUri(data.totpURI),
        backupCodes: data.backupCodes ?? [],
      });
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrolment = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: code.trim(),
      });
      if (error) {
        toast.error(failure(error, "That code is not valid"));
        return;
      }
      setBackupCodes(enrolment?.backupCodes ?? null);
      setEnrolment(null);
      setCode("");
      setEnabled(true);
      toast.success("Two-factor authentication is on");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const disableTwoFactor = async () => {
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.disable(confirmation);
      if (error) {
        toast.error(failure(error, "Could not turn off two-factor"));
        return;
      }
      setPassword("");
      setEnabled(false);
      setBackupCodes(null);
      toast.success("Two-factor authentication is off");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const regenerateBackupCodes = async () => {
    setBusy(true);
    try {
      const { data, error } =
        await authClient.twoFactor.generateBackupCodes(confirmation);
      if (error || !data) {
        toast.error(failure(error, "Could not create new backup codes"));
        return;
      }
      setPassword("");
      setBackupCodes(data.backupCodes);
    } finally {
      setBusy(false);
    }
  };

  const addPasskey = async () => {
    setBusy(true);
    try {
      const result = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || undefined,
      });
      if (result?.error) {
        toast.error(
          failure(
            result.error,
            "Could not add the passkey. Sign in again and retry.",
          ),
        );
        return;
      }
      setPasskeyName("");
      toast.success("Passkey added");
      await loadPasskeys();
    } finally {
      setBusy(false);
    }
  };

  const deletePasskey = async (id: string) => {
    setBusy(true);
    try {
      const { error } = await authClient.passkey.deletePasskey({ id });
      if (error) {
        toast.error(failure(error, "Could not remove the passkey"));
        return;
      }
      toast.success("Passkey removed");
      await loadPasskeys();
    } finally {
      setBusy(false);
    }
  };

  const revokeOtherSessions = async () => {
    setBusy(true);
    try {
      const { error } = await authClient.revokeOtherSessions();
      if (error) {
        toast.error(failure(error, "Could not sign out other sessions"));
        return;
      }
      toast.success("Signed out of every other session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, display: "flex", gap: 1, mb: 1 }}
        >
          <AuthenticatorIcon fontSize="small" /> Authenticator app
        </Typography>

        {backupCodes && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Save these backup codes somewhere safe. Each works once if you
              lose your authenticator.
            </Typography>
            <Box
              component="pre"
              data-testid="backup-codes"
              sx={{ m: 0, fontFamily: "monospace" }}
            >
              {backupCodes.join("\n")}
            </Box>
          </Alert>
        )}

        {enrolment ? (
          <Stack spacing={2}>
            <Typography variant="body2">
              Add Memoria to your authenticator app with this setup key, then
              enter the 6-digit code it shows.
            </Typography>
            <TextField
              label="Setup key"
              value={enrolment.secret}
              fullWidth
              slotProps={{ htmlInput: { readOnly: true } }}
            />
            <Button
              href={enrolment.totpURI}
              variant="text"
              sx={{ alignSelf: "flex-start" }}
            >
              Open in authenticator app
            </Button>
            <TextField
              label="Authentication code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              slotProps={{
                htmlInput: {
                  inputMode: "numeric",
                  pattern: "[0-9]*",
                  maxLength: 6,
                },
              }}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={confirmEnrolment}
                disabled={busy || !code}
                aria-describedby={!code ? "totp-code-reason" : undefined}
              >
                Turn on two-factor
              </Button>
              <Button
                onClick={() => {
                  setEnrolment(null);
                  setCode("");
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <DisabledReason id="totp-code-reason" show={!busy && !code}>
                Enter the code from your app first.
              </DisabledReason>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {enabled
                ? "Two-factor authentication is on. Sign-in asks for a code from your authenticator app."
                : "Require a code from an authenticator app when you sign in with your password."}
            </Typography>
            {hasPassword && (
              <TextField
                label="Password to confirm"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            )}
            <Stack direction="row" spacing={1}>
              {enabled ? (
                <>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={disableTwoFactor}
                    disabled={busy || needsPassword}
                    aria-describedby={
                      needsPassword ? "two-factor-password-reason" : undefined
                    }
                  >
                    Turn off two-factor
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={regenerateBackupCodes}
                    disabled={busy || needsPassword}
                    aria-describedby={
                      needsPassword ? "two-factor-password-reason" : undefined
                    }
                  >
                    New backup codes
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  onClick={startEnrolment}
                  disabled={busy || needsPassword}
                  aria-describedby={
                    needsPassword ? "two-factor-password-reason" : undefined
                  }
                >
                  Set up two-factor
                </Button>
              )}
              <DisabledReason
                id="two-factor-password-reason"
                show={!busy && needsPassword}
              >
                Enter your password first.
              </DisabledReason>
            </Stack>
          </Stack>
        )}
      </Box>

      <Divider />

      <Box>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, display: "flex", gap: 1, mb: 1 }}
        >
          <FingerprintIcon fontSize="small" /> Passkeys
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Sign in with your device&apos;s screen lock or a security key instead
          of your password.
        </Typography>
        {passkeys.length > 0 && (
          <List dense aria-label="Passkeys">
            {passkeys.map((key) => (
              <ListItem
                key={key.id}
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label={`Remove passkey ${key.name || ""}`.trim()}
                    onClick={() => deletePasskey(key.id)}
                    disabled={busy}
                  >
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={key.name || "Passkey"}
                  secondary={
                    key.createdAt
                      ? `Added ${new Date(key.createdAt).toLocaleDateString()}`
                      : undefined
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField
            label="Passkey name"
            size="small"
            value={passkeyName}
            onChange={(e) => setPasskeyName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 64 } }}
          />
          <Button variant="outlined" onClick={addPasskey} disabled={busy}>
            Add passkey
          </Button>
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Lost a device or signed in somewhere you no longer trust? End every
          session except this one.
        </Typography>
        <Button
          variant="outlined"
          startIcon={<LogoutIcon />}
          onClick={revokeOtherSessions}
          disabled={busy}
        >
          Sign out other sessions
        </Button>
      </Box>
    </Stack>
  );
}
