import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders,
} from "@/lib/api/api-key-auth";
import { Problems, unauthorizedError } from "@/lib/errors";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { INBOX_CANVAS_NAME } from "@/lib/agents/inbox";

/**
 * The canvases a browser button can save to (IMP-093): the key owner's own
 * canvases, the Inbox first, then the most recently changed. Names and ids
 * only, matching what `POST /api/v1/extensions/clip` accepts.
 */
export const GET = withApiHandler(async (request: NextRequest) => {
  const authResult = await authenticateApiKey(request);
  if (!authResult) throw unauthorizedError("Invalid API Key");

  const rateLimit = await checkApiKeyRateLimit(authResult.apiKeyId);
  const headers = {
    ...getApiKeyRateLimitHeaders(rateLimit),
    "Cache-Control": "private, no-store",
  };
  if (!rateLimit.allowed) {
    return NextResponse.json(
      Problems.TooManyRequests("Rate limit exceeded", rateLimit.resetIn),
      { status: 429, headers },
    );
  }

  const canvases = await prisma.canvas.findMany({
    where: { userId: authResult.user.id },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: LAUNCH_LIMITS.canvasesPerUser,
  });
  const inboxFirst = [
    ...canvases.filter((canvas) => canvas.name === INBOX_CANVAS_NAME),
    ...canvases.filter((canvas) => canvas.name !== INBOX_CANVAS_NAME),
  ];
  return NextResponse.json(
    { canvases: inboxFirst.map(({ id, name }) => ({ id, name })) },
    { headers },
  );
});
