"use client";

import React from "react";
import { Group, Rect, Text } from "react-konva";
import { toast } from "sonner";
import { isPollContent, type CanvasItemAdapterProps } from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import { useCanvasPalette } from "@/features/canvas/lib/canvas-palette";
import {
  nextPollChoices,
  usePollClose,
  usePollResult,
  usePollVote,
} from "@/features/canvas/hooks/use-poll-results";

type PollItemProps = CanvasItemAdapterProps;

const PADDING = 20;
const OPTION_HEIGHT = 40;
const OPTION_GAP = 10;
const HEADER_HEIGHT = 60;
const FOOTER_HEIGHT = 30;

/** The poll card's height for `optionCount` choices. */
export function pollHeight(optionCount: number): number {
  return (
    HEADER_HEIGHT +
    optionCount * (OPTION_HEIGHT + OPTION_GAP) +
    FOOTER_HEIGHT +
    PADDING
  );
}

/** "3 people voted • Single choice • Closed" */
export function pollFooter(
  voters: number,
  multipleChoice: boolean,
  closed: boolean,
): string {
  return [
    voters === 1 ? "1 person voted" : `${voters} people voted`,
    multipleChoice ? "Pick any" : "Pick one",
    ...(closed ? ["Closed"] : []),
  ].join(" • ");
}

/**
 * IMP-104: the question and choices come from the canvas; the counts and
 * the viewer's own choices come from the server. Clicking a choice records
 * the signed-in person's vote through the vote route; the owner can close
 * the poll.
 */
export function PollItem({
  item,
  isSelected,
  capabilities,
  onSelect,
  onContextMenu,
  onCommitGeometry,
}: PollItemProps) {
  const palette = useCanvasPalette();
  const result = usePollResult(item.canvasId, item.id);
  const { vote, isPending: voting } = usePollVote(item.canvasId, item.id);
  const { setClosed, isPending: closing } = usePollClose(
    item.canvasId,
    item.id,
  );

  if (!isPollContent(item.content)) return null;
  const { question, options } = item.content;
  const multipleChoice =
    result?.multipleChoice ?? item.content.multipleChoice === true;
  const closed = result?.closed ?? false;
  const mine = result?.myChoiceIds ?? [];
  const totalVotes = options.reduce(
    (sum, option) => sum + (result?.counts[option.id] ?? 0),
    0,
  );
  const canVote = capabilities.canVote && !closed && Boolean(result);

  const width = Math.max(item.width || 300, 300);
  const height = pollHeight(options.length);
  const innerWidth = width - PADDING * 2;

  const choose = (choiceId: string) => {
    if (!canVote || voting) return;
    vote(nextPollChoices(mine, choiceId, multipleChoice)).catch(
      (error: Error) =>
        toast.error(error.message || "Your vote was not saved."),
    );
  };

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
      onContextMenu={onContextMenu}
    >
      <Rect
        width={width}
        height={height}
        fill={palette.surface}
        cornerRadius={12}
        shadowColor="black"
        shadowBlur={isSelected ? 20 : 10}
        shadowOpacity={isSelected ? 0.2 : 0.1}
        shadowOffset={{ x: 0, y: 4 }}
        stroke={isSelected ? palette.selection : palette.border}
        strokeWidth={isSelected ? 2 : 1}
      />

      <Text
        x={PADDING}
        y={PADDING}
        width={innerWidth}
        text={question}
        fontSize={18}
        fontStyle="bold"
        fill={palette.text}
        wrap="word"
        height={HEADER_HEIGHT - PADDING}
      />

      {options.map((option, index) => {
        const y = HEADER_HEIGHT + index * (OPTION_HEIGHT + OPTION_GAP);
        const count = result?.counts[option.id] ?? 0;
        const isVoted = mine.includes(option.id);
        const percent = totalVotes > 0 ? (count / totalVotes) * 100 : 0;

        return (
          <Group
            key={option.id}
            name="poll-choice"
            x={PADDING}
            y={y}
            width={innerWidth}
            height={OPTION_HEIGHT}
            listening={canVote}
            onClick={(e) => {
              e.cancelBubble = true;
              choose(option.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              choose(option.id);
            }}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "pointer";
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "";
            }}
          >
            <Rect
              width={innerWidth}
              height={OPTION_HEIGHT}
              fill={isVoted ? palette.accentSofter : palette.surfaceSubtle}
              cornerRadius={8}
              stroke={isVoted ? palette.selection : palette.borderStrong}
              strokeWidth={1}
            />
            {totalVotes > 0 && (
              <Rect
                width={innerWidth * (percent / 100)}
                height={OPTION_HEIGHT}
                fill={isVoted ? palette.accentSoft : palette.border}
                cornerRadius={8}
                opacity={0.5}
              />
            )}
            <Text
              x={10}
              y={12}
              width={innerWidth - 90}
              text={`${isVoted ? "✓ " : ""}${option.text}`}
              fontSize={14}
              fill={isVoted ? palette.accentText : palette.textBody}
              wrap="none"
              ellipsis={true}
            />
            <Text
              x={innerWidth - 80}
              y={12}
              width={70}
              text={`${count} · ${Math.round(percent)}%`}
              fontSize={12}
              fill={palette.textMuted}
              align="right"
            />
          </Group>
        );
      })}

      <Text
        x={PADDING}
        y={height - FOOTER_HEIGHT}
        width={capabilities.canManageCanvas ? innerWidth - 90 : innerWidth}
        text={pollFooter(result?.voters ?? 0, multipleChoice, closed)}
        fontSize={11}
        fill={palette.textFaint}
      />
      {capabilities.canManageCanvas && result && (
        <Text
          name="poll-close"
          x={width - PADDING - 90}
          y={height - FOOTER_HEIGHT}
          width={90}
          text={closed ? "Reopen poll" : "Close poll"}
          fontSize={11}
          fontStyle="bold"
          fill={palette.accentText}
          align="right"
          onClick={(e) => {
            e.cancelBubble = true;
            if (closing) return;
            setClosed(!closed).catch((error: Error) =>
              toast.error(error.message || "The poll was not changed."),
            );
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            if (closing) return;
            setClosed(!closed).catch((error: Error) =>
              toast.error(error.message || "The poll was not changed."),
            );
          }}
        />
      )}
    </Group>
  );
}
