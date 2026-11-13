import { NextResponse } from "next/server";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { askMemoria, listAskScopeChoices } from "@/lib/ai/ask";
import { askRequestSchema } from "@/lib/ai/ask-schema";

/**
 * IMP-068 — ask your boards, or tell them what to do. Answers cite only the
 * caller's own items; a command comes back as an open suggestion that the
 * user approves through the agent suggestion path. Nothing is written here
 * except that suggestion.
 */
export const POST = withAuthValidation(
  askRequestSchema,
  async ({ question, scope }, request, session) => {
    const result = await askMemoria({
      userId: session.user.id,
      question,
      scope,
      signal: request.signal,
    });
    return NextResponse.json(result);
  },
);

/** IMP-101 — the canvases and tags a question can be limited to. */
export const GET = withAuth(async (_request, session) =>
  NextResponse.json(await listAskScopeChoices(session.user.id)),
);
