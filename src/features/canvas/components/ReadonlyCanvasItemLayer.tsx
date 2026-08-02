"use client";

import React from "react";
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
  isArrowContent,
  isBookmarkContent,
  isDrawingContent,
  isEmbedContent,
  isFrameContent,
  isImageContent,
  isNoteContent,
  isPollContent,
  isShapeContent,
  isTextContent,
} from "@/types/canvas";
import { stripHtmlTags } from "@/lib/utils/html";
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
  const [image] = useImage(src, "anonymous");

  if (!image) {
    return null;
  }

  return <KonvaImage image={image} x={x} y={y} width={width} height={height} />;
}

function ReadonlyImageItem({ item }: { item: CanvasItem }) {
  const imageContent = isImageContent(item.content) ? item.content : null;
  const [image] = useImage(imageContent?.url || "", "anonymous");

  if (!imageContent) {
    return null;
  }

  return (
    <Group x={item.positionX} y={item.positionY}>
      <Rect
        width={item.width}
        height={item.height}
        fill="#ffffff"
        stroke="#d7dee7"
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
          fill="#64748b"
          align="center"
        />
      )}
    </Group>
  );
}

function ReadonlyPollItem({ item }: { item: CanvasItem }) {
  if (!isPollContent(item.content)) {
    return null;
  }

  const width = Math.max(item.width || 300, 300);
  const padding = 20;
  const optionHeight = 36;
  const optionGap = 10;
  const headerHeight = 56;
  const totalVotes = item.content.options.reduce(
    (sum, option) => sum + option.votes.length,
    0,
  );
  const height =
    headerHeight +
    item.content.options.length * (optionHeight + optionGap) +
    padding * 2;

  return (
    <Group x={item.positionX} y={item.positionY}>
      <Rect
        width={width}
        height={height}
        fill="#ffffff"
        stroke="#d9e2ec"
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
        fill="#1e293b"
        wrap="word"
      />

      {item.content.options.map((option, index) => {
        const y = headerHeight + index * (optionHeight + optionGap);
        const percent =
          totalVotes > 0
            ? Math.round((option.votes.length / totalVotes) * 100)
            : 0;

        return (
          <Group key={option.id} x={padding} y={y}>
            <Rect
              width={width - padding * 2}
              height={optionHeight}
              fill="#f8fafc"
              stroke="#cbd5e1"
              strokeWidth={1}
              cornerRadius={8}
            />
            {percent > 0 && (
              <Rect
                width={(width - padding * 2) * (percent / 100)}
                height={optionHeight}
                fill="#dbeafe"
                cornerRadius={8}
                opacity={0.7}
              />
            )}
            <Text
              x={10}
              y={10}
              width={width - padding * 2 - 70}
              text={option.text}
              fontSize={14}
              fill="#334155"
              ellipsis
            />
            <Text
              x={width - padding * 2 - 55}
              y={10}
              width={45}
              text={`${percent}%`}
              fontSize={12}
              fill="#64748b"
              align="right"
            />
          </Group>
        );
      })}

      <Text
        x={padding}
        y={height - 20}
        width={width - padding * 2}
        text={`${totalVotes} votes | ${item.content.multipleChoice ? "Multiple Choice" : "Single Choice"} | Voting unavailable at launch`}
        fontSize={10}
        fill="#94a3b8"
        align="center"
      />
    </Group>
  );
}

function ReadonlyCanvasItem({ item }: { item: CanvasItem }) {
  if (item.type === ItemType.NOTE && isNoteContent(item.content)) {
    return (
      <Group x={item.positionX} y={item.positionY}>
        <Rect
          width={item.width}
          height={item.height}
          fill="#fffacd"
          stroke="#facc15"
          strokeWidth={2}
          cornerRadius={4}
          shadowBlur={4}
          shadowOpacity={0.15}
        />
        <Text
          x={10}
          y={10}
          width={item.width - 20}
          height={item.height - 20}
          text={stripHtmlTags(item.content.text)}
          fontSize={14}
          fill="#334155"
          wrap="word"
        />
      </Group>
    );
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
          fill="#fff9e6"
          stroke="#fdba74"
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
            fill="#fdba74"
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
          fill="#1f2937"
          ellipsis
        />
        <Text
          x={10}
          y={38}
          width={item.width - 20}
          height={item.height - 65}
          text={item.content.description || displayUrl}
          fontSize={12}
          fill="#64748b"
          wrap="word"
        />
        <Text
          x={10}
          y={item.height - 22}
          width={item.width - 20}
          text={displayUrl}
          fontSize={10}
          fill="#94a3b8"
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
      stroke: item.content.stroke || "#0f172a",
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
            fill={item.content.stroke || "#0f172a"}
          />
        )}
      </Group>
    );
  }

  if (item.type === ItemType.ARROW && isArrowContent(item.content)) {
    const start = item.content.startPoint || { x: 0, y: 0 };
    const end = item.content.endPoint || { x: item.width, y: item.height };

    return (
      <Group x={item.positionX} y={item.positionY}>
        <Arrow
          points={[start.x, start.y, end.x, end.y]}
          stroke={item.content.stroke || "#0f172a"}
          strokeWidth={item.content.strokeWidth || 2}
          fill={item.content.stroke || "#0f172a"}
          pointerLength={10}
          pointerWidth={10}
        />
        {item.content.label ? (
          <Text
            x={Math.min(start.x, end.x)}
            y={Math.min(start.y, end.y) - 18}
            text={item.content.label}
            fontSize={12}
            fill="#334155"
          />
        ) : null}
      </Group>
    );
  }

  if (item.type === ItemType.TEXT && isTextContent(item.content)) {
    return (
      <Group x={item.positionX} y={item.positionY}>
        <Text
          text={item.content.text}
          fontSize={item.content.fontSize || 16}
          fontFamily={item.content.fontFamily || "sans-serif"}
          fill={item.content.color || "#111827"}
          align={item.content.align || "left"}
          width={item.width}
        />
      </Group>
    );
  }

  if (item.type === ItemType.FRAME && isFrameContent(item.content)) {
    return (
      <Group x={item.positionX} y={item.positionY}>
        <Rect
          width={item.width}
          height={30}
          fill={item.content.backgroundColor || "#f1f5f9"}
          stroke="#cbd5e1"
          strokeWidth={1}
          cornerRadius={[4, 4, 0, 0]}
        />
        <Text
          x={10}
          y={8}
          text={item.content.title || "Frame"}
          fontSize={14}
          fill="#334155"
        />
        <Rect
          x={0}
          y={30}
          width={item.width}
          height={item.height - 30}
          fill="transparent"
          stroke="#cbd5e1"
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
          fill="#f8fafc"
          stroke="#cbd5e1"
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
          fill="#475569"
        />
        <Text
          x={10}
          y={item.height / 2 + 12}
          width={item.width - 20}
          text="Opens as a link; no live content is loaded in the canvas."
          align="center"
          fontSize={10}
          fill="#94a3b8"
          ellipsis
        />
      </Group>
    );
  }

  if (item.type === ItemType.POLL) {
    return <ReadonlyPollItem item={item} />;
  }

  return null;
}

interface ReadonlyCanvasItemLayerProps {
  items: CanvasItem[];
}

export function ReadonlyCanvasItemLayer({
  items,
}: ReadonlyCanvasItemLayerProps) {
  return (
    <Layer>
      {items.map((item) => (
        <ReadonlyCanvasItem key={item.id} item={item} />
      ))}
    </Layer>
  );
}
