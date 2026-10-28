import { type NextRequest } from "next/server";
import { z } from "zod";
import { getCachedSession } from "@/lib/api/session-cache";
import { withApiHandler } from "@/lib/api/route-handler";
import { decideConsent, OAuthError } from "@/lib/oauth/service";
import { oauthJsonResponse } from "@/lib/oauth/http";
import { UnauthorizedError } from "@/lib/errors";

const consentDecisionSchema = z.object({
  ticket: z.string().min(1).max(8192),
  approve: z.boolean(),
  canvasIds: z.array(z.string().max(64)).max(500).default([]),
  allowDirectWrites: z.boolean().default(false),
});

/**
 * Records the signed-in user's answer on the consent screen. The browser then
 * navigates to the returned address, so the code never passes through a
 * cross-origin form post (which the CSP's form-action would also block).
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const session = await getCachedSession();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }

  const data = consentDecisionSchema.parse(await request.json());

  try {
    const redirectTo = await decideConsent({
      ticket: data.ticket,
      userId: session.user.id,
      approve: data.approve,
      canvasIds: data.canvasIds,
      allowDirectWrites: data.allowDirectWrites,
    });
    return oauthJsonResponse({ redirectTo });
  } catch (error) {
    if (error instanceof OAuthError) {
      return oauthJsonResponse(
        { error: error.error, error_description: error.description },
        400,
      );
    }
    throw error;
  }
});
