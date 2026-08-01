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
import { useSession } from "next-auth/react";
import { useUpdateCanvasItem } from "@/lib/hooks/use-canvas-items";

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
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { mutate: updateItem } = useUpdateCanvasItem();

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

  const handleVote = (optionId: string) => {
    if (!userId || !capabilities.canVote) return;

    const newOptions = options.map((opt) => {
      const hasVoted = opt.votes.includes(userId);

      if (opt.id === optionId) {
        // Toggle vote
        return {
          ...opt,
          votes: hasVoted
            ? opt.votes.filter((id) => id !== userId)
            : [...opt.votes, userId],
        };
      } else {
        // If single choice, remove vote from others if currently voting for target
        // Logic: If I am clicking Option A, and I previously voted for Option B, remove B.
        // Wait, the logic above toggles.
        // If I click A, I vote A.
        // If I had voted B, and not multiple choice, B should be unvoted.
        // BUT if I allow unvoting A by clicking A again? Yes.

        // If we are ADDING a vote to the target option (opt.id === optionId, and !hasVoted)
        // Then clear others.
        const targetOption = options.find((o) => o.id === optionId);
        const isAddingVote =
          targetOption && !targetOption.votes.includes(userId);

        if (!multipleChoice && isAddingVote && opt.votes.includes(userId)) {
          return {
            ...opt,
            votes: opt.votes.filter((id) => id !== userId),
          };
        }
        return opt;
      }
    });

    updateItem({
      itemId: item.id,
      data: {
        version: item.version,
        content: {
          ...item.content,
          options: newOptions,
        },
      },
    });
  };

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
        const isVoted = userId ? option.votes.includes(userId) : false;
        const percent =
          totalVotes > 0 ? (option.votes.length / totalVotes) * 100 : 0;

        return (
          <Group
            key={option.id}
            x={padding}
            y={y}
            width={width - padding * 2}
            height={optionHeight}
            onClick={(e) => {
              e.cancelBubble = true;
              handleVote(option.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              handleVote(option.id);
            }}
          >
            {/* Option Background / Progress Bar */}
            <Rect
              width={width - padding * 2}
              height={optionHeight}
              fill={isVoted ? "#eff6ff" : "#f8fafc"}
              cornerRadius={8}
              stroke={isVoted ? "#3b82f6" : "#cbd5e1"}
              strokeWidth={1}
            />
            {/* Progress Fill */}
            {totalVotes > 0 && (
              <Rect
                width={(width - padding * 2) * (percent / 100)}
                height={optionHeight}
                fill={isVoted ? "#dbeafe" : "#e2e8f0"}
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
              fill={isVoted ? "#1d4ed8" : "#334155"}
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
        text={`${totalVotes} votes • ${multipleChoice ? "Multiple Choice" : "Single Choice"}`}
        fontSize={10}
        fill="#94a3b8"
        align="center"
      />
    </Group>
  );
}
