"use client";

/**
 * IMP-153: the owner invites someone to make an account. The link is shown
 * once, right after it is made; Memoria keeps only a scrambled copy.
 */

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ContentCopy as CopyIcon } from "@mui/icons-material";
import { DisabledReason } from "@/components/DisabledReason";

const ENDPOINT = "/api/v1/registration-invites";

interface Invite {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  status: "pending" | "used" | "expired";
}

interface InviteList {
  invites: Invite[];
  registrationMode: "open" | "invite" | "closed";
  mailConfigured: boolean;
}

interface NewInvite {
  email: string;
  url: string;
  emailQueued: boolean;
}

async function problem(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusLine(invite: Invite) {
  if (invite.status === "used") {
    return `Account made on ${formatDate(invite.usedAt ?? invite.createdAt)}`;
  }
  if (invite.status === "expired") {
    return `Link expired on ${formatDate(invite.expiresAt)}`;
  }
  return `Link works until ${formatDate(invite.expiresAt)}`;
}

export function RegistrationInviteSettings() {
  const [data, setData] = useState<InviteList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<NewInvite | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(ENDPOINT, { signal });
      if (!response.ok) throw new Error("Invite list request failed");
      setData((await response.json()) as InviteList);
      setLoadFailed(false);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const trimmed = email.trim();
  const createDisabledReason = !trimmed
    ? "Enter an email address first."
    : null;

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (createDisabledReason) return;
    setCreating(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!response.ok) {
        throw new Error(
          await problem(response, "Could not make the invite link."),
        );
      }
      const body = (await response.json()) as {
        invite: Invite;
        inviteUrl: string;
        emailQueued: boolean;
      };
      setCreated({
        email: body.invite.email,
        url: body.inviteUrl,
        emailQueued: body.emailQueued,
      });
      setEmail("");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not make the link.",
      );
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it yourself.");
    }
  };

  const revoke = async (invite: Invite) => {
    setRevoking(invite.id);
    try {
      const response = await fetch(`${ENDPOINT}/${invite.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(
          await problem(response, "Could not cancel the invite."),
        );
      }
      if (created?.email === invite.email) setCreated(null);
      toast.success(`Invite for ${invite.email} cancelled`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel the invite.",
      );
    } finally {
      setRevoking(null);
    }
  };

  if (loadFailed) {
    return <Alert severity="error">Failed to load your invites.</Alert>;
  }
  if (!data) return <Skeleton variant="rounded" height={120} />;

  return (
    <Stack spacing={3}>
      {data.registrationMode === "open" && (
        <Alert severity="info">
          Anyone can make an account here right now, so nobody needs an invite.
        </Alert>
      )}
      {data.registrationMode === "closed" && (
        <Alert severity="warning">
          New accounts are turned off here, so invite links will not work.
        </Alert>
      )}

      <Paper
        variant="outlined"
        sx={{ p: { xs: 2.5, sm: 3.5 }, borderRadius: 3 }}
      >
        <Typography variant="h6" component="h3" sx={{ fontWeight: 600, mb: 1 }}>
          Invite someone
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
          {data.mailConfigured
            ? "Memoria emails them a sign-up link that works once, for 7 days. You also see the link here, once, in case the email does not arrive."
            : "You get a sign-up link that works once, for 7 days. Memoria cannot send email here, so send them the link yourself."}
        </Typography>
        <Box
          component="form"
          onSubmit={createInvite}
          sx={{
            display: "flex",
            gap: 1.5,
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { sm: "flex-start" },
          }}
        >
          <TextField
            label="Their email address"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            size="small"
            fullWidth
          />
          <Box>
            <Button
              type="submit"
              variant="contained"
              disabled={creating || Boolean(createDisabledReason)}
              aria-describedby={
                createDisabledReason ? "invite-create-reason" : undefined
              }
              sx={{ whiteSpace: "nowrap", minHeight: 40 }}
            >
              {creating ? "Making link…" : "Make invite link"}
            </Button>
            <DisabledReason
              id="invite-create-reason"
              show={Boolean(createDisabledReason)}
            >
              {createDisabledReason}
            </DisabledReason>
          </Box>
        </Box>

        {created && (
          <Alert severity="success" sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {created.emailQueued
                ? `An email is on its way to ${created.email}. Copy the link now if you want to send it another way: it is not shown again.`
                : `Send this link to ${created.email}. Copy it now: it is not shown again.`}
            </Typography>
            <TextField
              value={created.url}
              size="small"
              fullWidth
              slotProps={{
                htmlInput: {
                  readOnly: true,
                  "aria-label": "Invite link",
                },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="Copy invite link"
                        onClick={() => void copyLink()}
                        edge="end"
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Alert>
        )}
      </Paper>

      <Paper
        variant="outlined"
        sx={{ p: { xs: 2.5, sm: 3.5 }, borderRadius: 3 }}
      >
        <Typography variant="h6" component="h3" sx={{ fontWeight: 600, mb: 1 }}>
          Your invites
        </Typography>
        {data.invites.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No invites yet.
          </Typography>
        ) : (
          <List disablePadding>
            {data.invites.map((invite) => (
              <ListItem
                key={invite.id}
                disableGutters
                secondaryAction={
                  invite.status === "used" ? null : (
                    <Button
                      size="small"
                      color="error"
                      disabled={revoking === invite.id}
                      onClick={() => void revoke(invite)}
                      aria-label={`Cancel invite for ${invite.email}`}
                    >
                      {invite.status === "pending" ? "Cancel" : "Remove"}
                    </Button>
                  )
                }
              >
                <ListItemText
                  primary={invite.email}
                  secondary={statusLine(invite)}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
