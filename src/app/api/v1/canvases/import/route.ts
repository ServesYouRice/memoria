import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api/auth";
import { runIdempotent, withApiHandler } from "@/lib/api/route-handler";
import { ValidationError } from "@/lib/errors";
import { ActivityType, logActivity } from "@/lib/activity";
import { boundRequestBody } from "@/lib/uploads/body-limit";
import { importCanvasFile } from "@/lib/canvas-formats/import-canvas";
import { MAX_CANVAS_FILE_BYTES } from "@/lib/canvas-formats/types";

/** Room for the form fields around the file. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/**
 * POST /api/v1/canvases/import (IMP-096)
 *
 * Open a `.canvas` (JSON Canvas) or `.excalidraw` file as a new canvas. A
 * form upload with `file` and an optional `name`. Answers with the new
 * canvas and what was brought in and left out.
 */
export const POST = withApiHandler(async (rawRequest: NextRequest) => {
  const { userId } = await requireAuth();
  const request = await boundRequestBody(
    rawRequest,
    MAX_CANVAS_FILE_BYTES + FORM_OVERHEAD_BYTES,
  );

  return runIdempotent(request, userId, async () => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ValidationError("Send the canvas file as a form upload.");
    }
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      throw new ValidationError("Choose a .canvas or .excalidraw file.");
    }
    if (file.size > MAX_CANVAS_FILE_BYTES) {
      throw new ValidationError("This file is larger than 10 MB.");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
    } catch {
      throw new ValidationError("This file is not a text file.");
    }
    const fileName = file instanceof File ? file.name : "canvas";
    const fallbackName =
      fileName.replace(/\.(canvas|excalidraw|json)$/i, "").trim() ||
      "Imported canvas";
    const rawName = form.get("name");
    const name = (
      typeof rawName === "string" && rawName.trim() ? rawName : fallbackName
    )
      .trim()
      .slice(0, 255);

    const result = await importCanvasFile(prisma, {
      userId,
      name,
      text,
      fileName,
    });
    await logActivity({
      userId,
      type: ActivityType.CANVAS_CREATED,
      canvasId: result.canvasId,
      canvasName: result.name,
    });
    return NextResponse.json(result, { status: 201 });
  });
});
