import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { errorResponse } from "@/lib/errors";
import { toCommittedEventEnvelope } from "@/lib/collaboration/committed-events";

const querySchema = z.object({
  cursor: z.coerce.bigint().nonnegative().default(0n),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ canvasId: string }> },
) {
  try {
    const { userId, email } = await requireAuth();
    const { canvasId } = await context.params;
    await requireCanvasAccess(canvasId, userId, email, "VIEW");
    const { cursor, limit } = querySchema.parse({
      cursor: request.nextUrl.searchParams.get("cursor") || undefined,
      limit: request.nextUrl.searchParams.get("limit") || undefined,
    });
    const oldest = await prisma.canvasEvent.findFirst({
      where: { canvasId },
      orderBy: { sequence: "asc" },
      select: { sequence: true },
    });
    if (cursor > 0n && oldest && cursor < oldest.sequence - 1n) {
      const latest = await prisma.canvasEvent.findFirst({
        where: { canvasId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      return NextResponse.json({
        events: [],
        nextCursor: latest?.sequence.toString() || "0",
        snapshotRequired: true,
      });
    }
    const events = await prisma.canvasEvent.findMany({
      where: { canvasId, sequence: { gt: cursor } },
      orderBy: { sequence: "asc" },
      take: limit + 1,
    });
    const hasMore = events.length > limit;
    const page = events.slice(0, limit);
    // A version restore replaced the canvas: item events cannot bring a
    // client across it. Return the events before it, ask for a snapshot and
    // move the cursor to the restore so the client continues after it.
    const restore = page.findIndex((event) => event.operation === "restored");
    if (restore >= 0) {
      return NextResponse.json({
        events: page.slice(0, restore).map(toCommittedEventEnvelope),
        nextCursor: page[restore]!.sequence.toString(),
        hasMore: true,
        snapshotRequired: true,
      });
    }
    return NextResponse.json({
      events: page.map(toCommittedEventEnvelope),
      nextCursor: page.at(-1)?.sequence.toString() || cursor.toString(),
      hasMore,
      snapshotRequired: false,
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
