"use client";

import React from "react";
import { Group, Rect, Text } from "react-konva";
import {
  type CanvasCapabilities,
  type CanvasItem,
  type CommitItemGeometry,
  isPollContent,
} from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";

interface PollItemProps {
  item: CanvasItem;
  isSelected?: boolean;
  onSelect?: () => void;
  onContextMenu?: (e: any) => void;
  capabilities: CanvasCapabilities;
  onCommitGeometry: CommitItemGeometry;
}

export function PollItem({
  item,
  isSelected,
  onSelect,
  onContextMenu,
  capabilities,
  onCommitGeometry,
}: PollItemProps) {
  if (!isPollContent(item.content)) return null;
  const { question, options, multipleChoice } = item.content;

  const totalVotes = options.reduce((acc, opt) => acc + opt.votes.length, 0);
  const width = Math.max(item.width || 300, 300);
  const padding = 20;
  const optionHeight = 40;
  const optionGap = 10;
  const headerHeight = 60; // Approximate for question

  // Simple dynamic height calculation
  const height =
    headerHeight + options.length * (optionHeight + optionGap) + padding * 2;

  return (
    <Group
      id={item.id}
      x={item.positionX}
      y={item.positionY}
      width={width}
      height={height}
      draggable={isSelected && capabilities.canMoveItems}
      onDragEnd={(event) =>
        commitGroupDragEnd(event, (geometry) =>
          onCommitGeometry(item, geometry),
        )
      }
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect?.();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect?.();
      }}
      onContextMenu={onContextMenu}
    >
      {/* Background */}
      <Rect
        width={width}
        height={height}
        fill="white"
        cornerRadius={12}
        shadowColor="black"
        shadowBlur={isSelected ? 20 : 10}
        shadowOpacity={isSelected ? 0.2 : 0.1}
        shadowOffset={{ x: 0, y: 4 }}
        stroke={isSelected ? "#2563eb" : "#e2e8f0"}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Header / Question */}
      <Text
        x={padding}
        y={padding}
        width={width - padding * 2}
        text={question}
        fontSize={18}
        fontStyle="bold"
        fill="#1e293b"
        wrap="word"
        height={headerHeight - padding} // limit height
      />

      {/* Options */}
      {options.map((option, index) => {
        const y = headerHeight + index * (optionHeight + optionGap);
        const percent =
          totalVotes > 0 ? (option.votes.length / totalVotes) * 100 : 0;

        return (
          <Group
            key={option.id}
            x={padding}
            y={y}
            width={width - padding * 2}
            height={optionHeight}
          >
            {/* Option Background / Progress Bar */}
            <Rect
              width={width - padding * 2}
              height={optionHeight}
              fill="#f8fafc"
              cornerRadius={8}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
            {/* Progress Fill */}
            {totalVotes > 0 && (
              <Rect
                width={(width - padding * 2) * (percent / 100)}
                height={optionHeight}
                fill="#e2e8f0"
                cornerRadius={8}
                opacity={0.5}
              />
            )}

            {/* Option Text */}
            <Text
              x={10}
              y={12}
              width={width - padding * 2 - 60} // reserve space for percent
              text={option.text}
              fontSize={14}
              fill="#334155"
              wrap="none"
              ellipsis={true}
            />

            {/* Vote Count / Percent */}
            <Text
              x={width - padding * 2 - 50}
              y={12}
              width={40}
              text={`${Math.round(percent)}%`}
              fontSize={12}
              fill="#64748b"
              align="right"
            />
          </Group>
        );
      })}

      {/* Footer Info */}
      <Text
        x={padding}
        y={height - 20}
        width={width - padding * 2}
        text={`${totalVotes} votes · ${multipleChoice ? "Multiple Choice" : "Single Choice"} · Voting unavailable at launch`}
        fontSize={10}
        fill="#94a3b8"
        align="center"
      />
    </Group>
  );
}
