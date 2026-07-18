"use client";

import { useEffect, useState } from "react";
import { Alert, CircularProgress, Stack, Typography } from "@mui/material";

type Health = {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: Record<string, { status: string }>;
};

export function StatusSummary() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as Health;
        setHealth(body);
        setFailed(!response.ok);
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
          health.status === "healthy"
            ? "success"
            : health.status === "degraded"
              ? "warning"
              : "error"
        }
      >
        Overall status: {health.status}
      </Alert>
      {Object.entries(health.checks).map(([name, check]) => (
        <Typography key={name}>
          {name}: <strong>{check.status}</strong>
        </Typography>
      ))}
      <Typography variant="caption" color="text.secondary">
        Checked {new Date(health.timestamp).toLocaleString()}
      </Typography>
    </Stack>
  );
}
