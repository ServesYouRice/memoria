import { type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { errorResponse } from "@/lib/errors";
import { requireTemplatesEnabled } from "@/lib/templates/availability";

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    requireTemplatesEnabled();
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
