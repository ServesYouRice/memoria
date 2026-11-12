import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { readBookmarkUpload } from "@/lib/import/request";
import { summarizeBookmarkFile } from "@/lib/import/bookmark-import";

/** What a bookmark file holds, before anything is saved (IMP-091). */
export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();
  const { fileName, parsed } = await readBookmarkUpload(request);
  const summary = await summarizeBookmarkFile(prisma, userId, parsed);
  return NextResponse.json(
    { fileName, format: parsed.format, ...summary },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
