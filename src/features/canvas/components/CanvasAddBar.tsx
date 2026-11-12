"use client";

import React from "react";
import {
  Box,
  ButtonBase,
  Divider,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  NearMe as SelectIcon,
  PanTool as PanIcon,
  StickyNote2Outlined as NoteIcon,
  LinkOutlined as LinkIcon,
  ImageOutlined as ImageIcon,
  TextFields as TextIcon,
  CropSquare as ShapeIcon,
  ArrowForward as ArrowIcon,
  Edit as DrawIcon,
} from "@mui/icons-material";
import { useCanvasStore, type CanvasTool } from "@/stores/canvasStore";

export interface CanvasAddBarProps {
  onAddNote: () => void;
  onAddLink: () => void;
  onAddImage: () => void;
}

type BarEntry = {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
} & ({ tool: CanvasTool } | { onClick: () => void });

function BarButton({
  entry,
  pressed,
  onClick,
}: {
  entry: BarEntry;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={entry.hint} placement="top" describeChild>
      <ButtonBase
        focusRipple
        onClick={onClick}
        aria-label={entry.label}
        aria-pressed={pressed}
        sx={{
          flexDirection: "column",
          gap: 0.25,
          minWidth: { xs: 38, sm: 60 },
          minHeight: 52,
          px: { xs: 0.25, sm: 0.75 },
          borderRadius: 2,
          color: pressed ? "primary.main" : "text.secondary",
          bgcolor: pressed ? "action.selected" : "transparent",
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
          "&.Mui-focusVisible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: 1,
          },
        }}
      >
        {entry.icon}
        <Typography
          component="span"
          sx={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}
        >
          {entry.label}
        </Typography>
      </ButtonBase>
    </Tooltip>
  );
}

/**
 * IMP-084: one labelled bar at the bottom centre for picking a tool and for
 * everything you can add. It replaces the unlabelled tool strip and the "+"
 * button; each entry does what it did before.
 */
export function CanvasAddBar({
  onAddNote,
  onAddLink,
  onAddImage,
}: CanvasAddBarProps) {
  const { activeTool, setActiveTool } = useCanvasStore();

  const pointers: BarEntry[] = [
    {
      key: "select",
      label: "Select",
      hint: "Select and move items",
      icon: <SelectIcon fontSize="small" />,
      tool: "select",
    },
    {
      key: "pan",
      label: "Pan",
      hint: "Drag to move around the canvas",
      icon: <PanIcon fontSize="small" />,
      tool: "pan",
    },
  ];
  const adds: BarEntry[] = [
    {
      key: "note",
      label: "Note",
      hint: "Add a sticky note",
      icon: <NoteIcon fontSize="small" />,
      onClick: onAddNote,
    },
    {
      key: "link",
      label: "Link",
      hint: "Save a web page as a card",
      icon: <LinkIcon fontSize="small" />,
      onClick: onAddLink,
    },
    {
      key: "image",
      label: "Image",
      hint: "Upload a picture",
      icon: <ImageIcon fontSize="small" />,
      onClick: onAddImage,
    },
    {
      key: "text",
      label: "Text",
      hint: "Click on the canvas to add text",
      icon: <TextIcon fontSize="small" />,
      tool: "text",
    },
    {
      key: "shape",
      label: "Shape",
      hint: "Drag on the canvas to draw a box",
      icon: <ShapeIcon fontSize="small" />,
      tool: "shape",
    },
    {
      key: "arrow",
      label: "Arrow",
      hint: "Drag on the canvas to draw an arrow",
      icon: <ArrowIcon fontSize="small" />,
      tool: "arrow",
    },
    {
      key: "draw",
      label: "Draw",
      hint: "Draw freehand with the pen",
      icon: <DrawIcon fontSize="small" />,
      tool: "draw",
    },
  ];

  const render = (entry: BarEntry) =>
    "tool" in entry ? (
      <BarButton
        key={entry.key}
        entry={entry}
        pressed={activeTool === entry.tool}
        onClick={() => setActiveTool(entry.tool)}
      />
    ) : (
      <BarButton key={entry.key} entry={entry} onClick={entry.onClick} />
    );

  return (
    <Paper
      elevation={3}
      role="toolbar"
      aria-label="Add to canvas"
      sx={{
        position: "absolute",
        left: "50%",
        bottom: { xs: 8, sm: 16 },
        transform: "translateX(-50%)",
        zIndex: 100,
        maxWidth: "calc(100% - 16px)",
        overflowX: "auto",
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        p: { xs: 0.25, sm: 0.5 },
        borderRadius: 3,
      }}
    >
      <Box sx={{ display: "flex", gap: { xs: 0, sm: 0.25 } }}>
        {pointers.map(render)}
      </Box>
      <Divider
        orientation="vertical"
        flexItem
        sx={{ mx: { xs: 0.25, sm: 0.5 } }}
      />
      <Box sx={{ display: "flex", gap: { xs: 0, sm: 0.25 } }}>
        {adds.map(render)}
      </Box>
    </Paper>
  );
}
