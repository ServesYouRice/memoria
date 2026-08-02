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
} from "@mui/icons-material";
import type { Activity } from "@/lib/hooks/use-activities";

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
};

export function getActivityMessage(
  activity: Pick<Activity, "type" | "canvasName">,
): string {
  const canvas = activity.canvasName ? `“${activity.canvasName}”` : "a canvas";
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
    default:
      return activity.type.toLowerCase().replace(/_/g, " ");
  }
}
