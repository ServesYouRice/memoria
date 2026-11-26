"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Box,
  Button,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import { Close as CloseIcon, History as OldIcon } from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import { markItemOpened, useSomethingOld } from "@/lib/hooks/use-reminders";
import { brand, motion } from "@/lib/theme";

const SNOOZE_STORAGE_KEY = "memoria.somethingOld.snoozed";

/**
 * IMP-097 — "Something old": one item not opened for at least 30 days, with
 * "Show another" and a session-scoped dismiss/snooze control. Hidden when
 * there is nothing that old or snoozed for the session. No AI.
 */
export function SomethingOldCard() {
  const [shown, setShown] = useState<string[]>([]);
  const [snoozed, setSnoozed] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SNOOZE_STORAGE_KEY) === "1") {
        setSnoozed(true);
      }
    } catch {
      // Storage can be blocked; in-memory dismissal still works.
    }
  }, []);

  const handleSnooze = () => {
    setSnoozed(true);
    try {
      window.sessionStorage.setItem(SNOOZE_STORAGE_KEY, "1");
    } catch {
      // Remembering dismissal for the session is a convenience only.
    }
  };

  const old = useSomethingOld(shown);
  if (snoozed) return null;

  const item = old.data;
  if (!item) {
    // Out of old items after "Show another": start over from the first.
    if (shown.length > 0 && old.isSuccess)
      return (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mb: 3,
            borderRadius: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            That is everything older than 30 days.{" "}
            <Button size="small" onClick={() => setShown([])}>
              Start over
            </Button>
          </Typography>
          <Tooltip title="Dismiss for this session">
            <IconButton
              size="small"
              aria-label="Dismiss for this session"
              onClick={handleSnooze}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Paper>
      );
    return null;
  }
  const since = item.lastOpenedAt ?? item.savedAt;
  return (
    <Paper
      key={item.id}
      variant="outlined"
      data-testid="something-old"
      sx={{
        p: 2,
        mb: 3,
        borderRadius: 3,
        borderLeft: `4px solid ${brand.highlight}`,
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
        animation: `cardShuffleIn 220ms ${motion.easeOut}`,
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
        },
      }}
    >
      <OldIcon sx={{ color: "text.secondary" }} />
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography variant="overline" sx={{ color: "text.secondary" }}>
          Something old
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
          {item.title}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          On {item.canvasName} · {item.lastOpenedAt ? "last opened" : "saved"}{" "}
          {formatDistanceToNow(new Date(since), { addSuffix: true })}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Button
          size="small"
          onClick={() =>
            setShown((current) => [...current, item.id].slice(-50))
          }
        >
          Show another
        </Button>
        <Button
          size="small"
          variant="contained"
          component={Link}
          href={item.url}
          onClick={() => markItemOpened(item.id)}
        >
          Open
        </Button>
        <Tooltip title="Dismiss for this session">
          <IconButton
            size="small"
            aria-label="Dismiss for this session"
            onClick={handleSnooze}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  );
}
