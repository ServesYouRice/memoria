import { type NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import { assertAgentCapability } from "@/lib/agents/policy";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { listScopedCanvases } from "@/lib/agents/query-core";

export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.READ);

  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") || "50", 10),
    100,
  );
  const offset = parseInt(
    request.nextUrl.searchParams.get("offset") || "0",
    10,
  );

  return NextResponse.json(
    await listScopedCanvases(context, {
      limit,
      offset,
    }),
  );
});
