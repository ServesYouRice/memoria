import { type NextRequest } from "next/server";
import { withApiHandler } from "@/lib/api/route-handler";
import { requireTemplatesEnabled } from "@/lib/templates/availability";

const disabledHandler = withApiHandler(async (_request: NextRequest) => {
  requireTemplatesEnabled();
});

export const GET = disabledHandler;
export const POST = disabledHandler;
