import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { parsePagination } from "@/lib/api/pagination";
import { prisma } from "@/lib/db";

const markReadSchema = z
  .object({
    ids: z.array(z.string().cuid()).min(1).max(100),
  })
  .strict();

export const GET = withApiHandler(async (request: Request) => {
  const { userId } = await requireAuth();
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams, {
    defaultLimit: 50,
    maxLimit: 100,
  });
  const where = { recipientId: userId };
  const [notifications, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        actor: { select: { id: true, name: true, image: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return NextResponse.json({
    notifications,
    unread,
    pagination: { total, limit, offset },
  });
});

export const PATCH = withApiHandler(async (request: Request) => {
  const { userId } = await requireAuth();
  const { ids } = markReadSchema.parse(await request.json());
  const result = await prisma.notification.updateMany({
    where: { id: { in: ids }, recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ updated: result.count });
});
