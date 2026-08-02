import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiHandler, withValidation } from "@/lib/api/route-handler";
import { clipSchema } from "@/lib/validation/extension";
import { ItemType } from "@/types/canvas";
import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders,
} from "@/lib/api/api-key-auth";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { Problems, notFoundError, unauthorizedError } from "@/lib/errors";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";

export const POST = withApiHandler(
  withValidation(
    clipSchema,
    async ({ url, title, selection, canvasId }, req) => {
      const authResult = await authenticateApiKey(req);
      if (!authResult) {
        throw unauthorizedError("Invalid API Key");
      }

      const rateLimit = await checkApiKeyRateLimit(authResult.apiKeyId);
      if (!rateLimit.allowed) {
        return NextResponse.json(
          Problems.TooManyRequests("Rate limit exceeded", rateLimit.resetIn),
          { status: 429, headers: getApiKeyRateLimitHeaders(rateLimit) },
        );
      }

      const user = authResult.user;
      let targetCanvasId = canvasId;

      if (!targetCanvasId) {
        // Find "Inbox" or "Unsorted" or first canvas
        const inbox = await prisma.canvas.findFirst({
          where: { userId: user.id, name: "Inbox" },
        });

        if (inbox) {
          targetCanvasId = inbox.id;
        } else {
          // Find first
          const first = await prisma.canvas.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: "asc" },
          });
          if (first) {
            targetCanvasId = first.id;
          } else {
            // Create Inbox
            const newInbox = await prisma.canvas.create({
              data: {
                userId: user.id,
                name: "Inbox",
              },
            });
            targetCanvasId = newInbox.id;
          }
        }
      }

      // Verify canvas ownership if ID provided
      if (canvasId) {
        const canvas = await prisma.canvas.findUnique({
          where: { id: canvasId },
        });
        if (!canvas || canvas.userId !== user.id) {
          throw notFoundError("Canvas", canvasId);
        }
      }

      // Create Item
      // Note: We random position avoid stacking if possible but random is fine for MVC
      const item = await prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, targetCanvasId);
        await assertCanvasItemCapacity(tx, targetCanvasId);
        return tx.canvasItem.create({
          data: {
            canvasId: targetCanvasId,
            type: ItemType.BOOKMARK,
            positionX: Math.random() * 400,
            positionY: Math.random() * 400,
            width: 300,
            height: 100,
            content: {
              url,
              title: title || url,
              description: selection,
            },
            createdById: user.id,
          },
        });
      });

      await invalidateCanvasCache(targetCanvasId);

      return NextResponse.json({ success: true, item });
    },
  ),
);
