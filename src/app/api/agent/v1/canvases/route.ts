import { type NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/route-handler";
import { resolveAgentRequestContext } from "@/lib/agents/auth";
import { assertAgentCapability } from "@/lib/agents/policy";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { listScopedCanvases } from "@/lib/agents/query-core";
import { parsePagination } from "@/lib/api/pagination";

export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await resolveAgentRequestContext(request);
  assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.READ);

  const { limit, offset } = parsePagination(request.nextUrl.searchParams, {
    defaultLimit: 50,
    maxLimit: 100,
  });

  return NextResponse.json(
    await listScopedCanvases(context, {
      limit,
      offset,
    }),
  );
});
