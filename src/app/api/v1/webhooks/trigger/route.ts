import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/route-handler";

export const POST = withApiHandler(async () => {
  return NextResponse.json(
    {
      error:
        "Generic inbound webhooks are disabled. Use /api/agent/v1/integrations/ingest with an integration token instead.",
    },
    { status: 410 },
  );
});
