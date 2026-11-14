"use client";

import React from "react";
import { arrowEnds } from "@/features/canvas/lib/arrow-attachment";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  RegularPolygon,
  Star,
  Text,
} from "react-konva";
import useImage from "use-image";
import type { CanvasItem } from "@/types/canvas";
import {
  ItemType,
  isArrowItemContent,
  isBookmarkContent,
  isDrawingContent,
  isEmbedContent,
  isFrameItemContent,
  isImageContent,
  isNoteContent,
  isPollContent,
  isShapeContent,
  isTableContent,
  isTextItemContent,
} from "@/types/canvas";
import { tableCellKey } from "@/lib/tables/table-content";
import { stripHtmlTags } from "@/lib/utils/html";
import { useThemeMode } from "@/lib/theme-context";
import { DotOverlay } from "@/features/canvas/components/GridOverlay";
import { NOTE_STYLE, noteColorsFor } from "@/features/canvas/lib/note-colors";
import {
  CANVAS_PALETTE,
  useCanvasPalette,
} from "@/features/canvas/lib/canvas-palette";
import { toImageProxyUrl } from "@/lib/images/proxy-url";
import {
  EMBED_PREVIEW_LABEL,
  describeEmbedTarget,
} from "@/lib/product-surfaces";

function ReadonlyBookmarkImage({
  src,
  x,
  y,
  width,
  height,
}: {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const [image] = useImage(toImageProxyUrl(src) ?? "", "anonymous");

  if (!image) {
    return null;
  }

  return <KonvaImage image={image} x={x} y={y} width={width} height={height} />;
}

function ReadonlyImageItem({ item }: { item: CanvasItem }) {
  const palette = useCanvasPalette();
  const imageContent = isImageContent(item.content) ? item.content : null;
  const [image] = useImage(
    toImageProxyUrl(imageContent?.url) ?? "",
    "anonymous",
  );

  if (!imageContent) {
    return null;
  }

  return (
    <Group x={item.positionX} y={item.positionY}>
      <Rect
        width={item.width}
        height={item.height}
        fill={palette.surface}
        stroke={palette.border}
        strokeWidth={1}
        cornerRadius={6}
      />
      {image ? (
        <KonvaImage
          image={image}
          width={item.width}
          height={item.height}
          cornerRadius={6}
        />
      ) : (
        <Text
          x={10}
          y={item.height / 2 - 10}
          width={item.width - 20}
          text={imageContent.filename || "Image"}
          fontSize={14}
          fill={palette.textMuted}
          align="center"
        />
      )}
    </Group>
  );
}

function ReadonlyTableItem({ item }: { item: CanvasItem }) {
  const palette = useCanvasPalette();
  if (!isTableContent(item.content)) return null;
  const table = item.content;
  const rowTop = table.rows.map((_, index) =>
    table.rows.slice(0, index).reduce((sum, row) => sum + row.height, 0),
  );
  const columnLeft = table.columns.map((_, index) =>
    table.columns
      .slice(0, index)
      .reduce((sum, column) => sum + column.width, 0),
  );
  return (
    <Group x={item.positionX} y={item.positionY}>
      {table.rows.map((row, rowIndex) =>
        table.columns.map((column, columnIndex) => (
          <Group
            key={`${row.id}:${column.id}`}
            x={columnLeft[columnIndex]}
            y={rowTop[rowIndex]}
          >
            <Rect
              width={column.width}
              height={row.height}
              fill={rowIndex === 0 ? palette.surfaceSubtle : palette.surface}
              stroke={palette.border}
              strokeWidth={1}
            />
            <Text
              x={8}
              y={8}
              width={Math.max(0, column.width - 16)}
              height={Math.max(0, row.height - 16)}
              text={table.cells[tableCellKey(row.id, column.id)] ?? ""}
              fontSize={14}
              fontStyle={rowIndex === 0 ? "bold" : "normal"}
              fill={palette.text}
              verticalAlign="middle"
              wrap="word"
              ellipsis
            />
          </Group>
        )),
      )}
    </Group>
  );
}

function ReadonlyPollItem({ item }: { item: CanvasItem }) {
  const palette = useCanvasPalette();
  if (!isPollContent(item.content)) {
    return null;
  }

  const width = Math.max(item.width || 300, 300);
  const padding = 20;
  const optionHeight = 36;
  const optionGap = 10;
  const headerHeight = 56;
  const height =
    headerHeight +
    item.content.options.length * (optionHeight + optionGap) +
    padding * 2;

  return (
    <Group x={item.positionX} y={item.positionY}>
      <Rect
        width={width}
        height={height}
        fill={palette.surface}
        stroke={palette.border}
        strokeWidth={1}
        cornerRadius={12}
      />
      <Text
        x={padding}
        y={padding}
        width={width - padding * 2}
        text={item.content.question}
        fontSize={18}
        fontStyle="bold"
        fill={palette.text}
        wrap="word"
      />

      {item.content.options.map((option, index) => {
        const y = headerHeight + index * (optionHeight + optionGap);

        return (
          <Group key={option.id} x={padding} y={y}>
            <Rect
              width={width - padding * 2}
              height={optionHeight}
              fill={palette.surfaceSubtle}
              stroke={palette.borderStrong}
              strokeWidth={1}
              cornerRadius={8}
            />
            <Text
              x={10}
              y={10}
              width={width - padding * 2 - 20}
              text={option.text}
              fontSize={14}
              fill={palette.textBody}
              ellipsis
            />
          </Group>
        );
      })}

      <Text
        x={padding}
        y={height - 20}
        width={width - padding * 2}
        // IMP-104: counts are read on the live canvas, never from content.
        text={`${item.content.multipleChoice ? "Pick any" : "Pick one"} • Results are on the live canvas`}
        fontSize={10}
        fill={palette.textFaint}
        align="center"
      />
    </Group>
  );
}

function ReadonlyNoteItem({ item }: { item: CanvasItem }) {
  const mode = useThemeMode().mode;
  if (!isNoteContent(item.content)) return null;
  const colors = noteColorsFor(item.content, mode);
  return (
    <Group x={item.positionX} y={item.positionY}>
      <Rect
        width={item.width}
        height={item.height}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={NOTE_STYLE.strokeWidth}
        cornerRadius={NOTE_STYLE.cornerRadius}
        shadowColor="black"
        shadowBlur={NOTE_STYLE.shadowBlur}
        shadowOpacity={NOTE_STYLE.shadowOpacity[mode]}
        shadowOffset={NOTE_STYLE.shadowOffset}
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
      />
      <Text
        x={NOTE_STYLE.padding}
        y={NOTE_STYLE.padding}
        width={item.width - NOTE_STYLE.padding * 2}
        height={item.height - NOTE_STYLE.padding * 2}
        text={item.content.plainText ?? stripHtmlTags(item.content.text)}
        fontSize={NOTE_STYLE.fontSize}
        lineHeight={NOTE_STYLE.lineHeight}
        fontFamily={NOTE_STYLE.fontFamily}
        fill={colors.text}
        wrap="word"
        ellipsis
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

function ReadonlyCanvasItem({
  item,
  itemsById,
}: {
  item: CanvasItem;
  itemsById: ReadonlyMap<string, CanvasItem>;
}) {
  const palette = useCanvasPalette();
  if (item.type === ItemType.NOTE && isNoteContent(item.content)) {
    return <ReadonlyNoteItem item={item} />;
  }

  if (item.type === ItemType.BOOKMARK && isBookmarkContent(item.content)) {
    const displayUrl =
      item.content.url.length > 50
        ? `${item.content.url.slice(0, 47)}...`
        : item.content.url;

    return (
      <Group x={item.positionX} y={item.positionY}>
        <Rect
          width={item.width}
          height={item.height}
          fill={palette.bookmark.fill}
          stroke={palette.bookmark.stroke}
          strokeWidth={2}
          cornerRadius={8}
        />
        {item.content.favicon ? (
          <ReadonlyBookmarkImage
            src={item.content.favicon}
            x={10}
            y={10}
            width={20}
            height={20}
          />
        ) : (
          <Rect
            x={10}
            y={10}
            width={20}
            height={20}
            fill={palette.bookmark.stroke}
            cornerRadius={4}
          />
        )}
        <Text
          x={38}
          y={10}
          width={item.width - 48}
          text={item.content.title || item.content.siteName || displayUrl}
          fontSize={15}
          fontStyle="bold"
          fill={palette.bookmark.text}
          ellipsis
        />
        <Text
          x={10}
          y={38}
          width={item.width - 20}
          height={item.height - 65}
          text={item.content.description || displayUrl}
          fontSize={12}
          fill={palette.textMuted}
          wrap="word"
        />
        <Text
          x={10}
          y={item.height - 22}
          width={item.width - 20}
          text={displayUrl}
          fontSize={10}
          fill={palette.textFaint}
          ellipsis
        />
      </Group>
    );
  }

  if (item.type === ItemType.IMAGE) {
    return <ReadonlyImageItem item={item} />;
  }

  if (item.type === ItemType.DRAWING && isDrawingContent(item.content)) {
    return (
      <Group x={item.positionX} y={item.positionY}>
        <Rect width={item.width} height={item.height} fill="transparent" />
        {item.content.paths.map((path, index) => (
          <Line
            key={`${item.id}-${index}`}
            points={path.points}
            stroke={path.stroke}
            strokeWidth={path.strokeWidth}
            opacity={path.opacity ?? 1}
            tension={path.tension ?? 0.5}
            lineCap="round"
            lineJoin="round"
          />
        ))}
      </Group>
    );
  }

  if (item.type === ItemType.SHAPE && isShapeContent(item.content)) {
    const commonProps = {
      stroke: item.content.stroke || palette.ink,
      fill: item.content.fill || "transparent",
      strokeWidth: item.content.strokeWidth || 2,
    };

    return (
      <Group x={item.positionX} y={item.positionY}>
        {item.content.shapeType === "rectangle" && (
          <Rect
            width={item.width}
            height={item.height}
            cornerRadius={item.content.radius || 0}
            {...commonProps}
          />
        )}
        {item.content.shapeType === "circle" && (
          <Circle
            x={item.width / 2}
            y={item.height / 2}
            radius={Math.min(item.width, item.height) / 2}
            {...commonProps}
          />
        )}
        {item.content.shapeType === "triangle" && (
          <RegularPolygon
            x={item.width / 2}
            y={item.height / 2}
            sides={3}
            radius={Math.min(item.width, item.height) / 2}
            {...commonProps}
          />
        )}
        {item.content.shapeType === "diamond" && (
          <RegularPolygon
            x={item.width / 2}
            y={item.height / 2}
            sides={4}
            radius={Math.min(item.width, item.height) / 2}
            rotation={45}
            {...commonProps}
          />
        )}
        {item.content.shapeType === "star" && (
          <Star
            x={item.width / 2}
            y={item.height / 2}
            numPoints={5}
            innerRadius={Math.min(item.width, item.height) / 4}
            outerRadius={Math.min(item.width, item.height) / 2}
            {...commonProps}
          />
        )}
        {item.content.shapeType === "arrow_shape" && (
          <Arrow
            points={[0, item.height / 2, item.width, item.height / 2]}
            pointerLength={20}
            pointerWidth={20}
            stroke={commonProps.stroke}
            strokeWidth={commonProps.strokeWidth}
            fill={item.content.stroke || palette.ink}
          />
        )}
      </Group>
    );
  }

  if (item.type === ItemType.ARROW && isArrowItemContent(item.content)) {
    // Attached ends follow their items, as in the editor (IMP-095).
    const ends = arrowEnds(
      {
        ...item,
        content: {
          ...item.content,
          endPoint: item.content.endPoint || { x: item.width, y: item.height },
        },
      },
      itemsById,
    );
    const start = {
      x: ends.start.x - item.positionX,
      y: ends.start.y - item.positionY,
    };
    const end = {
      x: ends.end.x - item.positionX,
      y: ends.end.y - item.positionY,
    };

    return (
      <Group x={item.positionX} y={item.positionY}>
        <Arrow
          points={[start.x, start.y, end.x, end.y]}
          stroke={item.content.stroke || palette.ink}
          strokeWidth={item.content.strokeWidth || 2}
          fill={item.content.stroke || palette.ink}
          pointerLength={10}
          pointerWidth={10}
          dash={
            item.content.lineStyle === "DASHED"
              ? [10, 6]
              : item.content.lineStyle === "DOTTED"
                ? [2, 6]
                : undefined
          }
        />
        {item.content.label ? (
          <Text
            x={Math.min(start.x, end.x)}
            y={Math.min(start.y, end.y) - 18}
            text={item.content.label}
            fontSize={12}
            fill={palette.textBody}
          />
        ) : null}
      </Group>
    );
  }

  if (item.type === ItemType.TEXT && isTextItemContent(item.content)) {
    return (
      <Group x={item.positionX} y={item.positionY}>
        <Text
          text={item.content.text}
          fontSize={item.content.fontSize || 16}
          fontFamily={item.content.fontFamily || "sans-serif"}
          fill={item.content.color || palette.ink}
          align={item.content.align || "left"}
          width={item.width}
        />
      </Group>
    );
  }

  if (item.type === ItemType.FRAME && isFrameItemContent(item.content)) {
    return (
      <Group x={item.positionX} y={item.positionY}>
        <Rect
          width={item.width}
          height={30}
          fill={item.content.backgroundColor || palette.frameFill}
          stroke={palette.borderStrong}
          strokeWidth={1}
          cornerRadius={[4, 4, 0, 0]}
        />
        <Text
          x={10}
          y={8}
          text={item.content.title || "Frame"}
          fontSize={14}
          fill={
            item.content.backgroundColor
              ? CANVAS_PALETTE.light.textBody
              : palette.textBody
          }
        />
        <Rect
          x={0}
          y={30}
          width={item.width}
          height={item.height - 30}
          fill="transparent"
          stroke={palette.borderStrong}
          strokeWidth={1}
          dash={[6, 4]}
          cornerRadius={[0, 0, 4, 4]}
        />
      </Group>
    );
  }

  if (item.type === ItemType.EMBED && isEmbedContent(item.content)) {
    return (
      <Group x={item.positionX} y={item.positionY}>
        <Rect
          width={item.width}
          height={item.height}
          fill={palette.surfaceSubtle}
          stroke={palette.borderStrong}
          strokeWidth={1}
          cornerRadius={8}
        />
        <Text
          x={0}
          y={item.height / 2 - 12}
          width={item.width}
          text={`${EMBED_PREVIEW_LABEL} · ${describeEmbedTarget(item.content.url)}`}
          align="center"
          fontSize={16}
          fill={palette.textMuted}
        />
        <Text
          x={10}
          y={item.height / 2 + 12}
          width={item.width - 20}
          text="Opens as a link; no live content is loaded in the canvas."
          align="center"
          fontSize={10}
          fill={palette.textFaint}
          ellipsis
        />
      </Group>
    );
  }

  if (item.type === ItemType.POLL) {
    return <ReadonlyPollItem item={item} />;
  }

  if (item.type === ItemType.TABLE) {
    return <ReadonlyTableItem item={item} />;
  }

  return null;
}

interface ReadonlyCanvasItemLayerProps {
  items: CanvasItem[];
}

export function ReadonlyCanvasItemLayer({
  items,
}: ReadonlyCanvasItemLayerProps) {
  const itemsById = React.useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  return (
    <Layer>
      {items.map((item) => (
        <ReadonlyCanvasItem key={item.id} item={item} itemsById={itemsById} />
      ))}
    </Layer>
  );
}

/** IMP-085: the same faint dotted background as the editor. */
export function ReadonlyCanvasBackground({
  width,
  height,
  zoom,
  position,
}: {
  width: number;
  height: number;
  zoom: number;
  position: { x: number; y: number };
}) {
  const palette = useCanvasPalette();
  return (
    <DotOverlay
      width={width}
      height={height}
      zoom={zoom}
      gridSize={20}
      offset={{ x: -position.x / zoom, y: -position.y / zoom }}
      visible
      stroke={palette.dot}
    />
  );
}
