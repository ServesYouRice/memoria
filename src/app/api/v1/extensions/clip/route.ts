import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiHandler, withValidation } from "@/lib/api/route-handler";
import { clipSchema } from "@/lib/validation/extension";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { ItemType } from "@/types/canvas";
import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders,
} from "@/lib/api/api-key-auth";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { Problems, notFoundError, unauthorizedError } from "@/lib/errors";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { enqueueLinkEnrichment } from "@/lib/services/link-enrichment";
import {
  existingFor,
  findExistingLinks,
  normalizeLinkUrl,
} from "@/lib/services/duplicates";

export const POST = withApiHandler(
  withValidation(
    clipSchema,
    async ({ url, title, selection, canvasId, allowDuplicate }, req) => {
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

      // "You saved this already" (IMP-065): report the existing copy and
      // offer it instead of quietly saving the link twice.
      const duplicates = existingFor(
        await findExistingLinks(prisma, user.id, [url]),
        url,
      );
      if (duplicates.length > 0 && !allowDuplicate) {
        const existing = await prisma.canvasItem.findUnique({
          where: { id: duplicates[0]!.itemId },
        });
        return NextResponse.json({
          success: true,
          created: false,
          duplicate: true,
          item: existing,
          duplicates,
        });
      }

      // The same bookmark rules as every other write path (scheme check,
      // URL sanitization, length caps); a refusal is a 400.
      const baseTitle = (title || url).slice(0, 500);
      const content = parseCanvasItemContent(ItemType.BOOKMARK, {
        url,
        title: baseTitle,
        description: selection,
      }) as { url: string };

      // Create Item
      // Note: We random position avoid stacking if possible but random is fine for MVC
      const item = await prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, targetCanvasId);
        await assertCanvasItemCapacity(tx, targetCanvasId);
        const created = await tx.canvasItem.create({
          data: {
            canvasId: targetCanvasId,
            type: ItemType.BOOKMARK,
            positionX: Math.random() * 400,
            positionY: Math.random() * 400,
            width: 300,
            height: 100,
            content,
            normalizedUrl: normalizeLinkUrl(content.url),
            createdById: user.id,
          },
        });
        await recordCanvasItemEvent(tx, {
          canvasId: targetCanvasId,
          actorId: user.id,
          itemId: created.id,
          version: created.version,
          operation: "created",
        });
        // Name, tag and summarize the link in the background (IMP-064).
        await enqueueLinkEnrichment(tx, user.id, [
          { itemId: created.id, baseTitle },
        ]);
        return created;
      });

      await invalidateCanvasCache(targetCanvasId);

      return NextResponse.json({
        success: true,
        created: true,
        duplicate: duplicates.length > 0,
        item,
        duplicates,
      });
    },
  ),
);
