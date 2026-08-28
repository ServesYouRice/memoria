import { type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { requireTemplatesEnabled } from "@/lib/templates/availability";

const disabledHandler = withApiHandler(async (_request: NextRequest) => {
  await requireAuth();
  requireTemplatesEnabled();
});

export const GET = disabledHandler;
export const PUT = disabledHandler;
export const DELETE = disabledHandler;
