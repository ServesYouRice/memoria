import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateApiKey } from "@/lib/api/api-key";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { getCachedSession } from "@/lib/api/session-cache";
import { ApiError, BadRequestError, fromZodError } from "@/lib/errors";

/**
 * A key outlives the session that made it, so creating one needs a session
 * that signed in this recently (any account type; no password re-check).
 */
const RECENT_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** Rejects unless the current session's row was created inside the window. */
async function requireRecentSignIn() {
  const session = await getCachedSession();
  const row = session?.session?.id
    ? await prisma.session.findUnique({
        where: { id: session.session.id },
        select: { createdAt: true },
      })
    : null;
  if (!row || Date.now() - row.createdAt.getTime() > RECENT_SIGN_IN_WINDOW_MS) {
    throw new ApiError(
      403,
      "https://memoria.local/errors/forbidden",
      "Forbidden",
      "Sign in again to create an API key: for your security this needs a sign-in from the last 15 minutes.",
      { code: "recent_sign_in_required" },
    );
  }
}

const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  expiresAt: z.string().datetime().optional().nullable(),
});

function buildKeyPreview(
  prefix: string | null,
  suffix: string | null,
): string | null {
  if (!prefix || !suffix) return null;
  return `${prefix}...${suffix}`;
}

export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();

  const keys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    keys: keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPreview: buildKeyPreview(key.keyPrefix, key.keySuffix),
      keyPrefix: key.keyPrefix,
      keySuffix: key.keySuffix,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
    })),
  });
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();
  await requireRecentSignIn();
  const body = await request.json();
  const validation = createApiKeySchema.safeParse(body);

  if (!validation.success) {
    throw fromZodError(validation.error);
  }

  const { name, expiresAt } = validation.data;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

  if (expiresAtDate && Number.isNaN(expiresAtDate.getTime())) {
    throw new BadRequestError("Invalid expiresAt value");
  }

  if (expiresAtDate && expiresAtDate <= new Date()) {
    throw new BadRequestError("expiresAt must be in the future");
  }

  const { key, hash } = await generateApiKey();
  const keyPrefix = key.slice(0, 7);
  const keySuffix = key.slice(-4);

  const record = await prisma.apiKey.create({
    data: {
      key: hash,
      name,
      userId,
      expiresAt: expiresAtDate,
      keyPrefix,
      keySuffix,
    },
  });

  return NextResponse.json(
    {
      apiKey: {
        id: record.id,
        name: record.name,
        keyPreview: buildKeyPreview(record.keyPrefix, record.keySuffix),
        keyPrefix: record.keyPrefix,
        keySuffix: record.keySuffix,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
      },
      plaintextKey: key,
    },
    { status: 201 },
  );
});
