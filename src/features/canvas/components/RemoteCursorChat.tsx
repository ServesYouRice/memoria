import React from "react";
import { Box, Paper, Typography } from "@mui/material";

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
          p: 1.5,
          borderRadius: "12px 12px 12px 0",
          backgroundColor: color,
          color: "#fff",
          maxWidth: 250,
          animation: "fadeIn 0.2s ease-out",
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
          textShadow: "0 1px 2px rgba(0,0,0,0.2)",
          ml: 1,
        }}
      >
        {senderName}
      </Typography>
    </Box>
  );
};
