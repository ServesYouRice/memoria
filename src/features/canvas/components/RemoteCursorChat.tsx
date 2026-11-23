import React from "react";
import { Box, Paper, Typography } from "@mui/material";
import { CANVAS_PALETTE } from "@/features/canvas/lib/canvas-palette";
import { motion } from "@/lib/theme";

interface RemoteCursorChatProps {
  x: number;
  y: number;
  message: string;
  senderName: string;
  color: string;
}

export const RemoteCursorChat: React.FC<RemoteCursorChatProps> = ({
  x,
  y,
  message,
  senderName,
  color,
}) => {
  return (
    <Box
      sx={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 1000,
        pointerEvents: "none", // Don't block clicks
        transform: "translateY(-100%)", // Show above cursor
      }}
    >
      <Paper
        elevation={3}
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: "14px 14px 14px 2px",
          backgroundColor: color,
          color: "common.white",
          maxWidth: 260,
          transformOrigin: "bottom left",
          animation: `bubblePop 240ms ${motion.springSnappy}`,
          mt: -1,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {message}
        </Typography>
      </Paper>
      <Typography
        variant="caption"
        sx={{
          color: color,
          fontWeight: 600,
          textShadow: `0 1px 2px ${CANVAS_PALETTE.light.shadow}`,
          ml: 1,
        }}
      >
        {senderName}
      </Typography>
    </Box>
  );
};
