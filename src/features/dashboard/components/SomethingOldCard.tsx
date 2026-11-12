"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Box, Button, Paper, Typography } from "@mui/material";
import { History as OldIcon } from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import { markItemOpened, useSomethingOld } from "@/lib/hooks/use-reminders";

/**
 * IMP-097 — "Something old": one item not opened for at least 30 days, with
 * "Show another". Hidden when there is nothing that old. No AI.
 */
export function SomethingOldCard() {
  const [shown, setShown] = useState<string[]>([]);
  const old = useSomethingOld(shown);
  const item = old.data;
  if (!item) {
    // Out of old items after "Show another": start over from the first.
    if (shown.length > 0 && old.isSuccess)
      return (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            That is everything older than 30 days.{" "}
            <Button size="small" onClick={() => setShown([])}>
              Start over
            </Button>
          </Typography>
        </Paper>
      );
    return null;
  }
  const since = item.lastOpenedAt ?? item.savedAt;
  return (
    <Paper
      variant="outlined"
      data-testid="something-old"
      sx={{
        p: 2,
        mb: 3,
        borderRadius: 3,
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
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
      <Box sx={{ display: "flex", gap: 1 }}>
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
      </Box>
    </Paper>
  );
}
