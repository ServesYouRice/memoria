"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { apiFetch } from "@/lib/api/fetch-client";
import { PageHeader } from "@/components/layout/PageHeader";

interface InvitationDetails {
  canvasName: string;
  inviterName: string;
  role: "VIEW" | "COMMENT" | "EDIT";
  expiresAt: string;
}

interface InvitationResult {
  action: "accept" | "decline";
  canvasId: string;
  canvasName: string;
}

export function InvitationResponseContent({ token }: { token: string }) {
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<
    "accept" | "decline" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/v1/share-invitations/${encodeURIComponent(token)}`;

  useEffect(() => {
    let active = true;
    apiFetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error("Invitation is unavailable");
        return (await response.json()) as InvitationDetails;
      })
      .then((value) => {
        if (active) setDetails(value);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Invitation is unavailable",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  const respond = async (action: "accept" | "decline") => {
    if (pendingAction) return;
    setPendingAction(action);
    setError(null);
    try {
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("Invitation is unavailable");
      setResult((await response.json()) as InvitationResult);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Invitation is unavailable",
      );
    } finally {
      setPendingAction(null);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress aria-label="Loading invitation" />
      </Box>
    );
  }

  if (result) {
    const accepted = result.action === "accept";
    return (
      <>
        <PageHeader
          title={accepted ? "Invitation accepted" : "Invitation declined"}
        />
        <Alert severity={accepted ? "success" : "info"} sx={{ mb: 3 }}>
          {accepted
            ? `You can now open ${result.canvasName}.`
            : `You declined the invitation to ${result.canvasName}.`}
        </Alert>
        <Button
          component={Link}
          href={accepted ? `/canvas/${result.canvasId}` : "/dashboard"}
          variant="contained"
        >
          {accepted ? "Open canvas" : "Back to dashboard"}
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Canvas invitation"
        subtitle="Review access before joining the canvas"
      />
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : details ? (
        <Paper
          variant="outlined"
          sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 3 }}
        >
          <Stack spacing={2.5}>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
              {details.inviterName} invited you to {details.canvasName}
            </Typography>
            <Typography color="text.secondary">
              Access level: {details.role.toLowerCase()}. This invitation
              expires {new Date(details.expiresAt).toLocaleString()}.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button
                variant="contained"
                onClick={() => void respond("accept")}
                disabled={pendingAction !== null}
              >
                {pendingAction === "accept"
                  ? "Accepting…"
                  : "Accept invitation"}
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={() => void respond("decline")}
                disabled={pendingAction !== null}
              >
                {pendingAction === "decline" ? "Declining…" : "Decline"}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}
    </>
  );
}
