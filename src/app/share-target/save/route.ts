/**
 * POST  /share-target/save — save a shared link to the Inbox (IMP-062).
 * PATCH /share-target/save — add the optional "How should this be sorted?"
 *                            note to that save.
 *
 * Session-authenticated companion of the share-target page. The save goes
 * through the same clip-batch service and validation as the extension's
 * `POST /api/v1/extensions/clip/batch` (IMP-061); the share id the page keeps
 * in its address bar becomes the idempotency key, so a reload replays the
 * first save instead of creating the link again.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/route-handler";
import { BadRequestError, fromZodError } from "@/lib/errors";
import {
  CLIP_BATCH_NOTE_MAX_LENGTH,
  clipBatchSchema,
} from "@/lib/validation/extension";
import { ClipBatchSource, saveClipBatch } from "@/lib/services/clip-batch";
import { setClipBatchNote } from "@/lib/services/clip-batch-note";
import { SHARE_ID_PATTERN, shareIdempotencyKey } from "../shared-link";

const saveSchema = z.object({
  shareId: z.string().regex(SHARE_ID_PATTERN),
  url: z.string(),
  title: z.string().optional(),
});

const noteSchema = z.object({
  batchId: z.string().min(1).max(64),
  note: z
    .string()
    .trim()
    .max(CLIP_BATCH_NOTE_MAX_LENGTH)
    .transform((value) => (value ? value : undefined)),
});

async function readJson(req: NextRequest): Promise<unknown> {
  // A JSON body cannot be sent cross-site without a CORS preflight.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new BadRequestError("Expected an application/json body");
  }
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("Invalid JSON");
  }
}

export const POST = withAuth(async (req, session) => {
  const parsed = saveSchema.safeParse(await readJson(req));
  if (!parsed.success) throw fromZodError(parsed.error);

  const batch = clipBatchSchema.safeParse({
    idempotencyKey: shareIdempotencyKey(parsed.data.shareId),
    links: [{ url: parsed.data.url, title: parsed.data.title }],
  });
  if (!batch.success) throw fromZodError(batch.error);

  const result = await saveClipBatch({
    userId: session.user.id,
    source: ClipBatchSource.SHARE_TARGET,
    data: batch.data,
  });
  return NextResponse.json(result, {
    status: result.replayed ? 200 : 201,
    headers: result.replayed ? { "X-Idempotency-Hit": "true" } : undefined,
  });
});

export const PATCH = withAuth(async (req, session) => {
  const parsed = noteSchema.safeParse(await readJson(req));
  if (!parsed.success) throw fromZodError(parsed.error);

  const result = await setClipBatchNote({
    userId: session.user.id,
    batchId: parsed.data.batchId,
    source: ClipBatchSource.SHARE_TARGET,
    note: parsed.data.note,
  });
  return NextResponse.json(result);
});
