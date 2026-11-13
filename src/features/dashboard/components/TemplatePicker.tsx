"use client";

import React from "react";
import { Box, ButtonBase, Skeleton, Typography } from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { useThemeMode } from "@/lib/theme-context";
import { NOTE_PALETTE } from "@/features/canvas/lib/note-colors";
import type { TemplateSummary } from "@/lib/hooks/use-templates";

export const BLANK_TEMPLATE = "blank";

/** A tiny drawing of the template's layout. */
function TemplatePreview({ template }: { template: TemplateSummary }) {
  const mode = useThemeMode().mode;
  const boxes = template.preview;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const pad = 20;
  return (
    <Box
      component="svg"
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      sx={{ width: "100%", height: 72, display: "block" }}
    >
      {boxes.map((b, index) => {
        if (b.type === "text")
          return (
            <Box
              component="rect"
              key={index}
              x={b.x}
              y={b.y + b.height / 3}
              width={Math.min(b.width, 300)}
              height={b.height / 3}
              rx={6}
              sx={{ fill: "text.secondary", opacity: 0.5 }}
            />
          );
        const note = b.type === "note" && b.color;
        return (
          <Box
            component="rect"
            key={index}
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            rx={b.type === "frame" ? 12 : 8}
            sx={
              note
                ? {
                    fill: NOTE_PALETTE[mode][b.color!].fill,
                    stroke: NOTE_PALETTE[mode][b.color!].stroke,
                    strokeWidth: 4,
                  }
                : {
                    fill: "none",
                    stroke: "currentColor",
                    color: "divider",
                    strokeWidth: 6,
                  }
            }
          />
        );
      })}
    </Box>
  );
}

function Tile({
  selected,
  onSelect,
  title,
  description,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <ButtonBase
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      aria-label={title}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        textAlign: "left",
        gap: 1,
        p: 1.5,
        borderRadius: 2,
        border: "2px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: "background.paper",
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
        },
      }}
    >
      {children}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {description}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

/**
 * IMP-098 — "Blank canvas" plus the built-in templates, each with a small
 * preview. `value` is a template id or `BLANK_TEMPLATE`.
 */
export function TemplatePicker({
  templates,
  loading,
  value,
  onChange,
}: {
  templates: TemplateSummary[] | undefined;
  loading: boolean;
  value: string;
  onChange: (templateId: string) => void;
}) {
  return (
    <Box
      role="radiogroup"
      aria-label="Start from"
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          sm: "repeat(3, minmax(0, 1fr))",
        },
        gap: 1.5,
      }}
    >
      <Tile
        selected={value === BLANK_TEMPLATE}
        onSelect={() => onChange(BLANK_TEMPLATE)}
        title="Blank canvas"
        description="Start with nothing on it."
      >
        <Box
          sx={{
            height: 72,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "text.secondary",
          }}
        >
          <AddIcon />
        </Box>
      </Tile>
      {loading &&
        Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} variant="rounded" height={140} />
        ))}
      {templates?.map((template) => (
        <Tile
          key={template.id}
          selected={value === template.id}
          onSelect={() => onChange(template.id)}
          title={template.name}
          description={template.description}
        >
          <TemplatePreview template={template} />
        </Tile>
      ))}
    </Box>
  );
}
