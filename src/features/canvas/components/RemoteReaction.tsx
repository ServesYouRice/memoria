import React from "react";
import { Box, Typography } from "@mui/material";
import { CANVAS_PALETTE } from "@/features/canvas/lib/canvas-palette";

interface RemoteReactionProps {
  x: number;
  y: number;
  emoji: string;
  senderName: string;
}

export const RemoteReaction: React.FC<RemoteReactionProps> = ({
  x,
  y,
  emoji,
  senderName,
}) => {
  return (
    <Box
      sx={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 1000,
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
        animation: "reactionFloat 2.8s ease-out forwards",
        willChange: "transform, opacity",
      }}
    >
      <Typography
        sx={{
          fontSize: "2.75rem",
          lineHeight: 1,
          filter: `drop-shadow(0 4px 8px ${CANVAS_PALETTE.light.shadow})`,
        }}
      >
        {emoji}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          mt: 0.5,
          whiteSpace: "nowrap",
          color: "common.white",
          backgroundColor: CANVAS_PALETTE.light.scrim,
          px: 0.75,
          py: 0.125,
          borderRadius: 1,
          fontSize: "0.7rem",
          fontWeight: 600,
        }}
      >
        {senderName}
      </Typography>
    </Box>
  );
};
