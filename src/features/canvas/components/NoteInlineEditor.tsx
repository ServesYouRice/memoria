"use client";

/**
 * IMP-142: type straight onto a sticky note.
 *
 * Drawn over the note inside the stage container, at the note's own size and
 * look and scaled by the board's zoom, so the text stays where it is on the
 * canvas. It edits the same shared text as the note dialog (IMP-042): every
 * keystroke reaches the canvas document and nothing needs saving.
 */

import React, { useEffect, useRef } from "react";
import { Box, Button, Typography } from "@mui/material";
import type * as Y from "yjs";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { CanvasItem } from "@/types/canvas";
import { useThemeMode } from "@/lib/theme-context";
import { NOTE_STYLE, noteColorsFor } from "@/features/canvas/lib/note-colors";
import { fragmentKey } from "@/features/canvas/lib/live-note";
import { noteScreenRect } from "@/features/canvas/lib/note-screen-rect";
import { appColor, motion } from "@/lib/theme";

/** Popups opened from the editor (such as its link dialog) count as inside. */
const EDITOR_POPUP_SELECTOR =
  ".MuiModal-root, .MuiPopover-root, .MuiPopper-root";

/** Room kept below the note for the Tags / Done bar, in screen pixels. */
const BAR_SPACE_PX = 56;
/** Minimum vertical clearance above the note before flipping the toolbar below. */
const TOOLBAR_CLEARANCE_PX = 60;

export interface NoteInlineEditorProps {
  item: Pick<
    CanvasItem,
    "id" | "content" | "positionX" | "positionY" | "width" | "height"
  >;
  fragment: Y.XmlFragment;
  position: { x: number; y: number };
  zoom: number;
  /** Height of the stage container, so a long note scrolls inside itself. */
  viewportHeight: number;
  onClose: () => void;
  /** Close the in-place editor and open the note dialog (for tags). */
  onTags: () => void;
}

export function NoteInlineEditor({
  item,
  fragment,
  position,
  zoom,
  viewportHeight,
  onClose,
  onTags,
}: NoteInlineEditorProps) {
  const { mode } = useThemeMode();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // A click or tap anywhere outside the editor ends editing.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapperRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(EDITOR_POPUP_SELECTOR)) {
        return;
      }
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  const rect = noteScreenRect(item, position, zoom);
  const colors = noteColorsFor(item.content, mode);
  // Counter-scale for controls that keep their normal size at any zoom.
  const unscale = `scale(${1 / zoom})`;
  const toolbarBelow = rect.top < TOOLBAR_CLEARANCE_PX;
  const maxHeight = Math.max(
    item.height,
    (viewportHeight - rect.top - BAR_SPACE_PX - (toolbarBelow ? 52 : 0)) / zoom,
  );

  return (
    <Box
      ref={wrapperRef}
      role="group"
      aria-label="Editing note"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Keys from a popup opened by the editor are that popup's own.
        if (!wrapperRef.current?.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      sx={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: item.width,
        transform: `scale(${zoom})`,
        transformOrigin: "top left",
        zIndex: 20,
        pointerEvents: "auto",
      }}
    >
      <RichTextEditor
        key={fragmentKey(fragment)}
        content={null}
        onChange={() => {}}
        collaboration={{ fragment }}
        placeholder="Type your note..."
        minHeight={item.height}
        autoFocus
        frameless
        toolbarSx={{
          position: "absolute",
          ...(toolbarBelow
            ? {
                top: "100%",
                mt: `${48 / zoom}px`,
                transformOrigin: "top left",
              }
            : {
                bottom: "100%",
                mb: `${8 / zoom}px`,
                transformOrigin: "bottom left",
              }),
          left: 0,
          width: "max-content",
          transform: unscale,
          bgcolor: appColor("floatingSurface"),
          backdropFilter: "blur(12px)",
          border: `1px solid ${appColor("floatingBorder")}`,
          borderRadius: 2.5,
          boxShadow: appColor("floatingShadow"),
          animation: `toolbarIn 180ms ${motion.easeOut}`,
        }}
        contentSx={{
          maxHeight,
          p: `${NOTE_STYLE.padding}px`,
          bgcolor: colors.fill,
          color: colors.text,
          borderRadius: `${NOTE_STYLE.cornerRadius}px`,
          outline: "2px solid",
          outlineColor: "primary.main",
          boxShadow: appColor("floatingShadow"),
          fontFamily: NOTE_STYLE.fontFamily,
          fontSize: `${NOTE_STYLE.fontSize}px`,
          lineHeight: String(NOTE_STYLE.lineHeight),
          "& .ProseMirror p": { m: 0 },
        }}
      />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          width: "max-content",
          mt: `${8 / zoom}px`,
          px: 1.25,
          py: 0.5,
          transform: unscale,
          transformOrigin: "top left",
          bgcolor: appColor("floatingSurface"),
          backdropFilter: "blur(12px)",
          border: `1px solid ${appColor("floatingBorder")}`,
          borderRadius: 2.5,
          boxShadow: appColor("floatingShadow"),
          animation: `toolbarIn 180ms ${motion.easeOut}`,
        }}
      >
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Changes save as you type.
        </Typography>
        <Button size="small" onClick={onTags}>
          Tags
        </Button>
        <Button size="small" variant="contained" onClick={onClose}>
          Done
        </Button>
      </Box>
    </Box>
  );
}
