import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { ApiError } from "@/lib/errors";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

const querySchema = z.object({ canvasId: z.string().cuid() });

export const GET = withApiHandler(async (request: Request) => {
  const { userId, email } = await requireAuth();
  const { canvasId } = querySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  await requireCanvasAccess(canvasId, userId, email, "VIEW");

  const items = await prisma.canvasItem.findMany({
    where: { canvasId, deletedAt: null, type: { not: "POLL" } },
    orderBy: [{ zIndex: "asc" }, { id: "asc" }],
    take: LAUNCH_LIMITS.itemsPerCanvas + 1,
    select: {
      id: true,
      type: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
      zIndex: true,
      version: true,
    },
  });
  if (items.length > LAUNCH_LIMITS.itemsPerCanvas) {
    throw new ApiError(
      409,
      "https://memoria.local/errors/canvas-capacity",
      "Canvas capacity invariant violated",
      "This canvas exceeds the supported item limit and cannot be indexed safely.",
    );
  }

  const body = { items };
  if (
    Buffer.byteLength(JSON.stringify(body), "utf8") >
    RESOURCE_BUDGETS.canvas.geometryIndexBytes
  ) {
    throw new ApiError(
      413,
      "https://memoria.local/errors/canvas-index-too-large",
      "Canvas index too large",
      "This canvas geometry index exceeds the supported response budget.",
    );
  }

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
