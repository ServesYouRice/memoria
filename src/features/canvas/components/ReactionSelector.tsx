import React from "react";
import { Paper, IconButton, Box } from "@mui/material";
import { appColor, motion } from "@/lib/theme";

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
        elevation={0}
        sx={{
          p: 0.75,
          display: "flex",
          gap: 0.25,
          borderRadius: 999,
          bgcolor: appColor("floatingSurface"),
          backdropFilter: "blur(12px)",
          border: `1px solid ${appColor("floatingBorder")}`,
          boxShadow: appColor("floatingShadow"),
          animation: `toolbarIn 180ms ${motion.springSnappy}`,
        }}
      >
        {REACTIONS.map((emoji, index) => (
          <IconButton
            key={emoji}
            size="small"
            aria-label={`React with ${emoji}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(emoji);
              onClose();
            }}
            sx={{
              fontSize: "1.25rem",
              width: 38,
              height: 38,
              animation: `popIn 240ms ${motion.springSnappy} ${index * 22}ms both`,
              transition: `transform 200ms ${motion.springSnappy}, background-color 140ms ease`,
              "&:hover": {
                transform: "scale(1.34) translateY(-4px)",
                bgcolor: "action.hover",
              },
            }}
          >
            {emoji}
          </IconButton>
        ))}
      </Paper>
    </Box>
  );
};
