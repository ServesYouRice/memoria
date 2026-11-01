import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CanvasVersionKind } from "@/generated/prisma/client";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { parsePagination } from "@/lib/api/pagination";
import { assertCanvasVersionCapacity } from "@/lib/policy/capacity";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { captureCanvasSnapshot } from "@/lib/versions/snapshot";
import { versionSummarySelect } from "@/lib/versions/summary";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}
const createVersionSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional() })
  .strict();
const listVersionsSchema = z.object({
  kind: z.nativeEnum(CanvasVersionKind).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;
    const { name } = createVersionSchema.parse(await request.json());
    const version = await prisma.$transaction(
      async (tx) => {
        await lockCanvasForMutation(tx, canvasId);
        await requireCanvasAccess(canvasId, userId, email, "EDIT", tx);
        // The snapshot is taken from the collaborative document (IMP-042),
        // brought up to date with any row write it has not absorbed yet;
        // item metadata comes from the rows.
        const captured = await captureCanvasSnapshot(tx, canvasId);
        await assertCanvasVersionCapacity(tx, canvasId);
        return tx.canvasVersion.create({
          data: {
            canvasId,
            kind: CanvasVersionKind.MANUAL,
            createdById: userId,
            name: name || `Version ${new Date().toISOString()}`,
            snapshot: captured.snapshot,
            yjsState: captured.yjsState,
            contentHash: captured.contentHash,
          },
          select: versionSummarySelect,
        });
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId, email } = await requireAuth();
    const { canvasId } = await params;
    const searchParams = new URL(request.url).searchParams;
    const { limit, offset } = parsePagination(searchParams, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const { kind } = listVersionsSchema.parse({
      kind: searchParams.get("kind") || undefined,
    });
    // Anyone who can view the canvas can read its history; restoring is
    // gated separately (restore route).
    await requireCanvasAccess(canvasId, userId, email, "VIEW");
    const where = { canvasId, ...(kind ? { kind } : {}) };
    const [versions, total] = await Promise.all([
      prisma.canvasVersion.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        skip: offset,
        select: versionSummarySelect,
      }),
      prisma.canvasVersion.count({ where }),
    ]);
    return NextResponse.json({
      versions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + versions.length < total,
      },
    });
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
