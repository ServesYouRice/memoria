"use client";

import React from "react";
import { Box, Slider, Button, Typography, Paper } from "@mui/material";
import { Restore, Close } from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import { appColor, motion } from "@/lib/theme";

interface TimeMachineControlProps {
  versions: any[];
  currentIndex: number;
  onChange: (index: number) => void;
  /** Omitted for viewers: restoring needs edit access. */
  onRestore?: (version: any) => void;
  onExit: () => void;
}

export function TimeMachineControl({
  versions,
  currentIndex,
  onChange,
  onRestore,
  onExit,
}: TimeMachineControlProps) {
  const currentVersion = versions[currentIndex];

  if (!currentVersion) return null;

  return (
    <Paper
      elevation={0}
      sx={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: "90%",
        maxWidth: 760,
        p: 2.5,
        borderRadius: 4,
        bgcolor: appColor("floatingSurface"),
        backdropFilter: "blur(12px)",
        border: `1px solid ${appColor("floatingBorder")}`,
        boxShadow: appColor("floatingShadow"),
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        animation: `toolbarIn 220ms ${motion.springGentle}`,
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h6">Replay changes</Typography>
        <Box>
          <Typography
            variant="subtitle1"
            component="span"
            sx={{ mr: 2, fontWeight: "bold" }}
          >
            {currentVersion.name}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
            }}
          >
            {formatDistanceToNow(new Date(currentVersion.createdAt), {
              addSuffix: true,
            })}
          </Typography>
        </Box>
        <Button startIcon={<Close />} onClick={onExit} size="small">
          Exit
        </Button>
      </Box>

      <Slider
        value={currentIndex}
        min={0}
        max={versions.length - 1}
        onChange={(_, val) => onChange(val as number)}
        step={1}
        marks
        valueLabelDisplay="auto"
        valueLabelFormat={(idx) => versions[idx]?.name || ""}
      />

      {onRestore && (
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<Restore />}
            onClick={() => onRestore(currentVersion)}
          >
            Restore this version
          </Button>
        </Box>
      )}
    </Paper>
  );
}
