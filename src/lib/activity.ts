/**
 * Activity logging utilities
 */

import { type Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { createLogger } from "./logger";

const logger = createLogger("activity");

export enum ActivityType {
  CANVAS_CREATED = "CANVAS_CREATED",
  CANVAS_UPDATED = "CANVAS_UPDATED",
  CANVAS_DELETED = "CANVAS_DELETED",
  CANVAS_SHARED = "CANVAS_SHARED",
  ITEM_CREATED = "ITEM_CREATED",
  ITEM_UPDATED = "ITEM_UPDATED",
  ITEM_DELETED = "ITEM_DELETED",
  COMMENT_ADDED = "COMMENT_ADDED",
  TEMPLATE_CREATED = "TEMPLATE_CREATED",
  TEMPLATE_USED = "TEMPLATE_USED",
}

interface LogActivityOptions {
  userId: string;
  type: ActivityType;
  canvasId?: string;
  canvasName?: string;
  itemId?: string;
  metadata?: Prisma.InputJsonObject;
}

/**
 * Log an activity to the database
 */
export async function logActivity(options: LogActivityOptions): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        userId: options.userId,
        type: options.type,
        canvasId: options.canvasId,
        canvasName: options.canvasName,
        itemId: options.itemId,
        metadata: options.metadata || undefined,
      },
    });
  } catch (error) {
    // Don't throw on activity logging failures - log and continue
    logger.warn({ error, type: options.type }, "Failed to log activity");
  }
}
