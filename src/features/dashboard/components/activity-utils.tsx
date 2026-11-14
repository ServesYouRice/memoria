/**
 * Shared helpers for rendering user activities
 * (used by the dashboard ActivityFeed and the notifications page).
 */

import React from "react";
import {
  Add,
  Edit,
  Delete,
  Share,
  Comment,
  ContentCopy,
  SmartToyOutlined,
} from "@mui/icons-material";
import type { Activity } from "@/lib/hooks/use-activities";

const ITEM_TYPES = new Set(["ITEM_CREATED", "ITEM_UPDATED", "ITEM_DELETED"]);

export const activityIcons: Record<string, React.ReactNode> = {
  CANVAS_CREATED: <Add fontSize="small" />,
  CANVAS_UPDATED: <Edit fontSize="small" />,
  CANVAS_DELETED: <Delete fontSize="small" />,
  CANVAS_SHARED: <Share fontSize="small" />,
  ITEM_CREATED: <Add fontSize="small" />,
  ITEM_UPDATED: <Edit fontSize="small" />,
  ITEM_DELETED: <Delete fontSize="small" />,
  COMMENT_ADDED: <Comment fontSize="small" />,
  TEMPLATE_CREATED: <ContentCopy fontSize="small" />,
  TEMPLATE_USED: <ContentCopy fontSize="small" />,
  WORKSPACE_AGENT_NOTES_UPDATED: <SmartToyOutlined fontSize="small" />,
};

export const activityColors: Record<string, string> = {
  CANVAS_CREATED: "success",
  CANVAS_UPDATED: "info",
  CANVAS_DELETED: "error",
  CANVAS_SHARED: "primary",
  ITEM_CREATED: "success",
  ITEM_UPDATED: "info",
  ITEM_DELETED: "error",
  COMMENT_ADDED: "primary",
  TEMPLATE_CREATED: "secondary",
  TEMPLATE_USED: "secondary",
  WORKSPACE_AGENT_NOTES_UPDATED: "secondary",
};

export function getActivityMessage(
  activity: Pick<Activity, "type" | "canvasName"> &
    Partial<Pick<Activity, "metadata">>,
): string {
  // IMP-138: names are stored or filled in by the API, so an item row with
  // none is about a canvas that no longer exists.
  const canvas = activity.canvasName
    ? `“${activity.canvasName}”`
    : ITEM_TYPES.has(activity.type)
      ? "a deleted canvas"
      : "a canvas";
  switch (activity.type) {
    case "CANVAS_CREATED":
      return `created canvas ${canvas}`;
    case "CANVAS_UPDATED":
      return `updated canvas ${canvas}`;
    case "CANVAS_DELETED":
      return `deleted canvas ${canvas}`;
    case "CANVAS_SHARED":
      return `shared canvas ${canvas}`;
    case "ITEM_CREATED":
      return `added an item to ${canvas}`;
    case "ITEM_UPDATED":
      return `updated an item in ${canvas}`;
    case "ITEM_DELETED":
      return `deleted an item from ${canvas}`;
    case "COMMENT_ADDED":
      return `commented on ${canvas}`;
    case "TEMPLATE_CREATED":
      return `created template ${canvas}`;
    case "TEMPLATE_USED":
      return `used template ${canvas}`;
    case "WORKSPACE_AGENT_NOTES_UPDATED": {
      const name = activity.metadata?.workspaceName;
      const where = typeof name === "string" ? `“${name}”` : "a workspace";
      return activity.metadata?.cleared
        ? `removed the notes for AI agents in ${where}`
        : `changed the notes for AI agents in ${where}`;
    }
    default:
      return activity.type.toLowerCase().replace(/_/g, " ");
  }
}

const GROUP_GAP_MS = 60 * 60 * 1000;

type GroupableActivity = Pick<
  Activity,
  "id" | "type" | "canvasId" | "canvasName" | "createdAt"
> &
  Partial<Pick<Activity, "metadata">>;

/** Activity rows shown as one line; `activities` is newest first. */
export interface ActivityGroup<T extends GroupableActivity> {
  key: string;
  latest: T;
  activities: T[];
}

/**
 * IMP-138: join neighbouring item rows of the same kind on the same canvas
 * when each is less than an hour from the next. Expects newest first.
 */
export function groupActivities<T extends GroupableActivity>(
  activities: T[],
): ActivityGroup<T>[] {
  const groups: ActivityGroup<T>[] = [];
  for (const activity of activities) {
    const group = groups.at(-1);
    const previous = group?.activities.at(-1);
    if (
      group &&
      previous &&
      ITEM_TYPES.has(activity.type) &&
      activity.type === previous.type &&
      activity.canvasId !== null &&
      activity.canvasId === previous.canvasId &&
      Math.abs(
        new Date(previous.createdAt).getTime() -
          new Date(activity.createdAt).getTime(),
      ) < GROUP_GAP_MS
    ) {
      group.activities.push(activity);
    } else {
      groups.push({
        key: activity.id,
        latest: activity,
        activities: [activity],
      });
    }
  }
  return groups;
}

/** The message for a group; one row keeps `getActivityMessage`'s text. */
export function getActivityGroupMessage<T extends GroupableActivity>(
  group: ActivityGroup<T>,
): string {
  const count = group.activities.length;
  if (count === 1) return getActivityMessage(group.latest);
  const name = group.activities.find((row) => row.canvasName)?.canvasName;
  const canvas = name ? `“${name}”` : "a deleted canvas";
  switch (group.latest.type) {
    case "ITEM_CREATED":
      return `added ${count} items to ${canvas}`;
    case "ITEM_UPDATED":
      return `updated ${count} items in ${canvas}`;
    case "ITEM_DELETED":
      return `deleted ${count} items from ${canvas}`;
    default:
      return getActivityMessage(group.latest);
  }
}
