import React from "react";
import { Paper, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import {
  AlignHorizontalLeft,
  AlignHorizontalCenter,
  AlignHorizontalRight,
  AlignVerticalTop,
  AlignVerticalCenter,
  AlignVerticalBottom,
  ViewColumn,
  TableRows,
} from "@mui/icons-material";

import { appColor, motion } from "@/lib/theme";

interface AlignmentToolbarProps {
  onAlign: (
    type: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) => void;
  onDistribute: (type: "horizontal" | "vertical") => void;
}

export const AlignmentToolbar: React.FC<AlignmentToolbarProps> = ({
  onAlign,
  onDistribute,
}) => {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 0.75,
        borderRadius: 3,
        display: "flex",
        gap: 1,
        bgcolor: appColor("floatingSurface"),
        backdropFilter: "blur(12px)",
        border: `1px solid ${appColor("floatingBorder")}`,
        boxShadow: appColor("floatingShadow"),
        animation: `toolbarIn 180ms ${motion.easeOut}`,
      }}
    >
      <ToggleButtonGroup size="small" exclusive>
        <ToggleButton value="left" onClick={() => onAlign("left")}>
          <Tooltip title="Align left">
            <AlignHorizontalLeft fontSize="small" />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="center" onClick={() => onAlign("center")}>
          <Tooltip title="Align center">
            <AlignHorizontalCenter fontSize="small" />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="right" onClick={() => onAlign("right")}>
          <Tooltip title="Align right">
            <AlignHorizontalRight fontSize="small" />
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>

      <ToggleButtonGroup size="small" exclusive>
        <ToggleButton value="top" onClick={() => onAlign("top")}>
          <Tooltip title="Align top">
            <AlignVerticalTop fontSize="small" />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="middle" onClick={() => onAlign("middle")}>
          <Tooltip title="Align middle">
            <AlignVerticalCenter fontSize="small" />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="bottom" onClick={() => onAlign("bottom")}>
          <Tooltip title="Align bottom">
            <AlignVerticalBottom fontSize="small" />
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>

      <ToggleButtonGroup size="small" exclusive>
        <ToggleButton
          value="distribute-h"
          onClick={() => onDistribute("horizontal")}
        >
          <Tooltip title="Distribute horizontally">
            <ViewColumn fontSize="small" />
          </Tooltip>
        </ToggleButton>
        <ToggleButton
          value="distribute-v"
          onClick={() => onDistribute("vertical")}
        >
          <Tooltip title="Distribute vertically">
            <TableRows fontSize="small" />
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>
    </Paper>
  );
};
