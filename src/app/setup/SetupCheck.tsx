"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  CheckCircle as PassIcon,
  ErrorOutlined as FailIcon,
} from "@mui/icons-material";
import { COLLABORATION_SYNC_PATH } from "@/lib/collaboration/sync/protocol";
import { SETUP_CHECKS } from "@/lib/operations/setup-fixes.mjs";

/**
 * The first-run set-up check (IMP-100): the server tests its own parts,
 * and this page opens a live collaboration connection from the browser, so
 * the check crosses the same proxy every visitor will.
 */

interface CheckRow {
  name: string;
  label: string;
  ok: boolean;
  fix?: string;
}

const LIVE_TIMEOUT_MS = 6_000;

/** Opens the document-sync socket and reports whether it got through. */
export function probeLiveConnection(
  origin: string,
  createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  timeoutMs = LIVE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = createSocket(
        `${origin.replace(/^http/, "ws")}${COLLABORATION_SYNC_PATH}`,
      );
    } catch {
      resolve(false);
      return;
    }
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      socket.onopen = socket.onerror = socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

function liveRow(ok: boolean): CheckRow {
  const { label, fix } = SETUP_CHECKS["live-connection"];
  return ok
    ? { name: "live-connection", label, ok }
    : { name: "live-connection", label, ok, fix };
}

export function SetupCheck() {
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setProblem(null);
    try {
      const [server, live] = await Promise.all([
        fetch("/api/setup/check", { cache: "no-store" })
          .then(async (response) =>
            response.ok
              ? ((await response.json()) as { checks: CheckRow[] }).checks
              : response.status === 429 || response.status === 503
                ? "busy"
                : "failed",
          )
          .catch(() => "failed" as const),
        probeLiveConnection(window.location.origin),
      ]);
      if (typeof server === "string") {
        setProblem(
          server === "busy"
            ? `The check could not run right now. If this keeps happening: ${SETUP_CHECKS.redis.fix}`
            : "The check could not reach Memoria's server. Check that the app is running and look at its logs.",
        );
        setRows([liveRow(live)]);
      } else {
        setRows([...server, liveRow(live)]);
      }
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const allOk = rows !== null && !problem && rows.every((row) => row.ok);

  return (
    <Box
      component="section"
      aria-labelledby="setup-check-title"
      sx={{ maxWidth: 640, mx: "auto", mb: 4 }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography id="setup-check-title" variant="h6" component="h2">
          Set-up check
        </Typography>
        <Button size="small" onClick={() => void run()} disabled={running}>
          Check again
        </Button>
      </Stack>
      {running && rows === null ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Checking each part…</Typography>
        </Stack>
      ) : (
        <Stack
          spacing={1}
          component="ul"
          sx={{ listStyle: "none", p: 0, m: 0 }}
        >
          {rows?.map((row) => (
            <Box component="li" key={row.name}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                {row.ok ? (
                  <PassIcon color="success" fontSize="small" aria-hidden />
                ) : (
                  <FailIcon color="error" fontSize="small" aria-hidden />
                )}
                <Typography variant="body2">
                  {row.label}: {row.ok ? "working" : "not working"}
                </Typography>
              </Stack>
              {row.fix && (
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary", ml: 3.5 }}
                >
                  {row.fix}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
      {problem && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {problem}
        </Alert>
      )}
      {allOk && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Every part is working. Create the first account below.
        </Alert>
      )}
    </Box>
  );
}
