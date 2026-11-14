"use client";

import React from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import { isPdfContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import {
  useCanvasPalette,
  type CanvasPalette,
} from "@/features/canvas/lib/canvas-palette";
import {
  PDF_CARD_HEIGHT,
  PDF_CARD_WIDTH,
  describePdfFile,
  describePdfText,
  pdfFileUrl,
  type PdfContent,
} from "@/lib/pdf/pdf-content";

const PADDING = 14;
const BUTTON_WIDTH = 64;
const BUTTON_HEIGHT = 28;

/**
 * IMP-113: open a PDF card's file in the browser's own viewer, in a new
 * tab. The file is never drawn inside the app.
 */
export function openPdf(content: { assetId: string }) {
  window.open(pdfFileUrl(content.assetId), "_blank", "noopener,noreferrer");
}

function setCursor(event: Konva.KonvaEventObject<MouseEvent>, cursor: string) {
  const container = event.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

/**
 * The card's face: name, pages and size, what happened to its text, and an
 * "Open" button. Shared by the editable and the read-only canvas.
 */
export function PdfCardFace({
  content,
  width,
  height,
  palette,
  selected = false,
}: {
  content: PdfContent;
  width: number;
  height: number;
  palette: CanvasPalette;
  selected?: boolean;
}) {
  const innerWidth = Math.max(0, width - PADDING * 2);
  const open = (event: Konva.KonvaEventObject<Event>) => {
    event.cancelBubble = true;
    openPdf(content);
  };
  return (
    <>
      <Rect
        width={width}
        height={height}
        fill={palette.surface}
        cornerRadius={10}
        shadowColor="black"
        shadowBlur={selected ? 16 : 8}
        shadowOpacity={selected ? 0.18 : 0.08}
        shadowOffset={{ x: 0, y: 3 }}
        stroke={selected ? palette.selection : palette.border}
        strokeWidth={selected ? 2 : 1}
      />
      <Rect
        x={PADDING}
        y={PADDING}
        width={34}
        height={42}
        cornerRadius={4}
        fill={palette.accentSofter}
        stroke={palette.borderStrong}
        strokeWidth={1}
      />
      <Text
        x={PADDING}
        y={PADDING + 15}
        width={34}
        text="PDF"
        align="center"
        fontSize={10}
        fontStyle="bold"
        fill={palette.accentText}
        listening={false}
      />
      <Text
        x={PADDING + 46}
        y={PADDING + 2}
        width={Math.max(0, innerWidth - 46)}
        text={content.filename}
        fontSize={15}
        fontStyle="bold"
        fill={palette.text}
        wrap="none"
        ellipsis
        listening={false}
      />
      <Text
        x={PADDING + 46}
        y={PADDING + 24}
        width={Math.max(0, innerWidth - 46)}
        text={describePdfFile(content)}
        fontSize={12}
        fill={palette.textMuted}
        wrap="none"
        ellipsis
        listening={false}
      />
      <Text
        x={PADDING}
        y={PADDING + 52}
        width={Math.max(0, innerWidth - BUTTON_WIDTH - 8)}
        height={height - PADDING * 2 - 52}
        text={describePdfText(content.textStatus)}
        fontSize={11}
        fill={palette.textFaint}
        wrap="word"
        ellipsis
        listening={false}
      />
      <Group
        name="pdf-open"
        x={width - PADDING - BUTTON_WIDTH}
        y={height - PADDING - BUTTON_HEIGHT}
        onClick={open}
        onTap={open}
        onMouseEnter={(event) => setCursor(event, "pointer")}
        onMouseLeave={(event) => setCursor(event, "")}
      >
        <Rect
          width={BUTTON_WIDTH}
          height={BUTTON_HEIGHT}
          cornerRadius={6}
          fill={palette.accentSoft}
          stroke={palette.selection}
          strokeWidth={1}
        />
        <Text
          width={BUTTON_WIDTH}
          height={BUTTON_HEIGHT}
          text="Open"
          align="center"
          verticalAlign="middle"
          fontSize={13}
          fontStyle="bold"
          fill={palette.accentText}
        />
      </Group>
    </>
  );
}

export function PdfItem({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
}: CanvasItemAdapterProps) {
  const palette = useCanvasPalette();
  if (!isPdfContent(item.content)) return null;
  const content = item.content;
  const width = Math.max(item.width || PDF_CARD_WIDTH, 200);
  const height = Math.max(item.height || PDF_CARD_HEIGHT, 110);

  return (
    <Group
      id={item.id}
      x={item.positionX}
      y={item.positionY}
      width={width}
      height={height}
      draggable={isSelected && capabilities.canMoveItems}
      onDragEnd={(e) => commitGroupDragEnd(e, onCommitGeometry)}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      // Anyone who can see the card can open its file.
      onDblClick={(e) => {
        e.cancelBubble = true;
        openPdf(content);
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        openPdf(content);
      }}
      onContextMenu={onContextMenu}
    >
      <PdfCardFace
        content={content}
        width={width}
        height={height}
        palette={palette}
        selected={isSelected}
      />
    </Group>
  );
}
