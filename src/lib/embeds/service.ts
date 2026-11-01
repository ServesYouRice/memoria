/**
 * Canvas embed service
 *
 * Owner-only management plus token resolution for the read-only embed page.
 * Ownership is always read from the canvas row, never from the caller's claim.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  createEmbedToken,
  digestEmbedToken,
  verifyEmbedTokenSignature,
} from "./token";

export const MAX_ACTIVE_EMBEDS_PER_CANVAS = 20;
export const DEFAULT_EMBED_TTL_DAYS = 90;
export const MAX_EMBED_TTL_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const embedSummarySelect = {
  id: true,
  label: true,
  allowedOrigins: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

async function requireOwnedCanvas(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
) {
  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, userId },
    select: { id: true },
  });
  if (!canvas) throw new ForbiddenError("You do not own this canvas");
  return canvas;
}

export async function listCanvasEmbeds(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
) {
  await requireOwnedCanvas(prisma, canvasId, userId);
  return prisma.canvasEmbed.findMany({
    where: { canvasId },
    orderBy: { createdAt: "desc" },
    select: embedSummarySelect,
  });
}

export async function createCanvasEmbed(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
  input: {
    label: string;
    allowedOrigins: string[];
    expiresInDays?: number;
  },
  now: Date = new Date(),
) {
  await requireOwnedCanvas(prisma, canvasId, userId);

  const active = await prisma.canvasEmbed.count({
    where: { canvasId, revokedAt: null, expiresAt: { gt: now } },
  });
  if (active >= MAX_ACTIVE_EMBEDS_PER_CANVAS) {
    throw new ConflictError(
      `A canvas can have at most ${MAX_ACTIVE_EMBEDS_PER_CANVAS} active embeds`,
    );
  }

  const { token, digest } = createEmbedToken();
  const ttlDays = input.expiresInDays ?? DEFAULT_EMBED_TTL_DAYS;
  const embed = await prisma.canvasEmbed.create({
    data: {
      canvasId,
      label: input.label,
      tokenDigest: digest,
      allowedOrigins: input.allowedOrigins,
      expiresAt: new Date(now.getTime() + ttlDays * DAY_MS),
    },
    select: embedSummarySelect,
  });
  return { embed, token };
}

export async function revokeCanvasEmbed(
  prisma: PrismaClient,
  canvasId: string,
  embedId: string,
  userId: string,
  now: Date = new Date(),
) {
  await requireOwnedCanvas(prisma, canvasId, userId);
  const embed = await prisma.canvasEmbed.findFirst({
    where: { id: embedId, canvasId },
    select: { id: true, revokedAt: true },
  });
  if (!embed) throw new NotFoundError("Embed not found");
  if (!embed.revokedAt) {
    await prisma.canvasEmbed.updateMany({
      where: { id: embedId, canvasId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}

/**
 * Resolves a presented token to its live embed. Returns null for forged,
 * unknown, revoked, or expired tokens (callers must not distinguish them).
 */
export async function resolveEmbedToken(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
) {
  if (!verifyEmbedTokenSignature(token)) return null;
  const embed = await prisma.canvasEmbed.findUnique({
    where: { tokenDigest: digestEmbedToken(token) },
    select: {
      id: true,
      canvasId: true,
      allowedOrigins: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!embed || embed.revokedAt || embed.expiresAt <= now) return null;
  return embed;
}
