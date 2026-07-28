import { type NextRequest } from "next/server";
import { errorResponse } from "@/lib/errors";
import { requireTemplatesEnabled } from "@/lib/templates/availability";

export async function POST(request: NextRequest) {
  try {
    requireTemplatesEnabled();
  } catch (error) {
    return errorResponse(error, request.url);
  }
}
