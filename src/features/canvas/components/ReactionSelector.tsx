import React from "react";
import { Paper, IconButton, Box } from "@mui/material";

const REACTIONS = ["👍", "❤️", "🔥", "😂", "😮", "🎉"];

interface ReactionSelectorProps {
  x: number;
  y: number;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export const ReactionSelector: React.FC<ReactionSelectorProps> = ({
  x,
  y,
  onSelect,
  onClose,
}) => {
  return (
    <Box
      sx={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 1000,
      }}
      onMouseLeave={onClose}
    >
      <Paper
        elevation={4}
        sx={{
          p: 1,
          display: "flex",
          gap: 0.5,
          borderRadius: 4,
        }}
      >
        {REACTIONS.map((emoji) => (
          <IconButton
            key={emoji}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(emoji);
              onClose();
            }}
            sx={{ fontSize: "1.2rem" }}
          >
            {emoji}
          </IconButton>
        ))}
      </Paper>
    </Box>
  );
};
