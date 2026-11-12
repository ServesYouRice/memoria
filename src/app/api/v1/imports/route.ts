import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { ValidationError } from "@/lib/errors";
import { importOptionsSchema, readBookmarkUpload } from "@/lib/import/request";
import {
  bookmarkImportResponse,
  createBookmarkImport,
} from "@/lib/import/bookmark-import";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** The person's recent bookmark imports, newest first (IMP-091). */
export const GET = withApiHandler(async () => {
  const { userId } = await requireAuth();
  const imports = await prisma.bookmarkImport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return NextResponse.json(
    { imports: imports.map(bookmarkImportResponse) },
    { headers: NO_STORE },
  );
});

/** Start importing a bookmark file in the background (IMP-091). */
export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth();
  const { form, fileName, parsed } = await readBookmarkUpload(request);
  const options = importOptionsSchema.parse({
    destination: form.get("destination") ?? undefined,
    enrich: form.get("enrich") ?? undefined,
  });
  if (parsed.links.length === 0) {
    throw new ValidationError("This file has no links to import.");
  }
  const record = await createBookmarkImport(prisma, {
    userId,
    fileName,
    parsed,
    destination: options.destination,
    enrich: options.enrich,
  });
  return NextResponse.json(bookmarkImportResponse(record), {
    status: 202,
    headers: NO_STORE,
  });
});
