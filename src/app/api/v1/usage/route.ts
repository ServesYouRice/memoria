import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { getAiUsage } from "@/lib/ai/budget";

export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();
  const [canvases, workspaces, items, shares, versions, uploadQuota, ai] =
    await Promise.all([
      prisma.canvas.count({ where: { userId } }),
      prisma.workspace.count({ where: { userId } }),
      prisma.canvasItem.count({
        where: { canvas: { userId }, deletedAt: null },
      }),
      prisma.canvasShare.count({ where: { canvas: { userId } } }),
      prisma.canvasVersion.count({ where: { canvas: { userId } } }),
      prisma.uploadQuota.findUnique({ where: { userId } }),
      getAiUsage(userId),
    ]);
  return NextResponse.json({
    usage: {
      canvases,
      workspaces,
      activeItems: items,
      shares,
      versions,
      uploads: uploadQuota?.assetCount || 0,
      uploadBytes: Number(uploadQuota?.totalBytes || 0n),
      ai,
    },
    limits: LAUNCH_LIMITS,
  });
});
