"use client";

import { useEffect, useState } from "react";
import { Alert, CircularProgress, Stack, Typography } from "@mui/material";
import {
  publicStatusSchema,
  type PublicStatus,
} from "@/lib/operations/public-status";

export function StatusSummary() {
  const [health, setHealth] = useState<PublicStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("status request failed");
        const body = publicStatusSchema.safeParse(await response.json());
        if (!body.success) throw new Error("invalid status response");
        setHealth(body.data);
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError")
          setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (!health && !failed)
    return <CircularProgress aria-label="Checking service status" />;
  if (!health)
    return (
      <Alert severity="error">The health endpoint could not be reached.</Alert>
    );

  return (
    <Stack spacing={2}>
      <Alert
        severity={
          health.status === "operational"
            ? "success"
            : health.status === "degraded"
              ? "warning"
              : "error"
        }
      >
        Service status: {health.status}
      </Alert>
      <Typography>
        {health.status === "operational"
          ? "Core services are operating normally."
          : health.status === "degraded"
            ? "Core service is available, but a feature is temporarily degraded."
            : "Core service is temporarily unavailable."}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
        }}
      >
        Checked {new Date(health.checkedAt).toLocaleString()}
      </Typography>
    </Stack>
  );
}
