/**
 * Read-only embed page
 *
 * Verifies the signed token against the database on every request. Framing
 * headers for this route are chosen in `src/proxy.ts` from the same lookup; an
 * unknown, forged, expired, or revoked token renders the standard 404 page,
 * which keeps the global frame denial.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { withEmbedAssetTokens } from "@/lib/embeds/assets";
import { withSignedImageProxyUrls } from "@/lib/images/signed-proxy";
import { resolveEmbedToken } from "@/lib/embeds/service";
import type { CanvasItem } from "@/types/canvas";
import { EmbedViewer } from "./EmbedViewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Embedded canvas",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Upper bound on items rendered in one embed. */
const EMBED_MAX_ITEMS = 500;

interface EmbedPageProps {
  params: Promise<{ token: string }>;
}

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { token } = await params;
  const embed = await resolveEmbedToken(prisma, token);
  if (!embed) notFound();

  const canvas = await prisma.canvas.findUnique({
    where: { id: embed.canvasId },
    select: { name: true, zoomLevel: true, panX: true, panY: true },
  });
  if (!canvas) notFound();

  const items = await prisma.canvasItem.findMany({
    where: { canvasId: embed.canvasId, deletedAt: null, type: { not: "POLL" } },
    orderBy: [{ zIndex: "asc" }, { id: "asc" }],
    take: EMBED_MAX_ITEMS,
    select: {
      id: true,
      canvasId: true,
      type: true,
      positionX: true,
      positionY: true,
      width: true,
      height: true,
      zIndex: true,
      content: true,
      tags: true,
      version: true,
      createdById: true,
      updatedById: true,
      deletedById: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  });

  return (
    <EmbedViewer
      name={canvas.name}
      zoomLevel={canvas.zoomLevel}
      panX={canvas.panX}
      panY={canvas.panY}
      items={withSignedImageProxyUrls(
        withEmbedAssetTokens(items as unknown as CanvasItem[], token),
      )}
    />
  );
}
