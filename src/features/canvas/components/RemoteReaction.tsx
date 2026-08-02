import React from "react";
import { Box, Typography } from "@mui/material";

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
        animation: "popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      }}
    >
      <Typography
        sx={{
          fontSize: "3rem",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))",
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
          whiteSpace: "nowrap",
          color: "white",
          backgroundColor: "rgba(0,0,0,0.6)",
          px: 0.5,
          borderRadius: 1,
          fontSize: "0.7rem",
        }}
      >
        {senderName}
      </Typography>
    </Box>
  );
};
