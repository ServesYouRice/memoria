/**
 * Notes from uploads (IMP-071).
 *
 * GET  without `assetId`: what this user's saved AI provider can offer
 *      (`readImage`, `speechToText`). Secret-free.
 * GET  with `assetId`: the state of the note made from that upload.
 * POST `{ assetId, sourceItemId?, positionX?, positionY? }`: queue the job
 *      that reads or transcribes the upload into a titled note next to it.
 *
 * Canvas EDIT access and the provider capability are checked here; the job
 * re-checks access and applies the AI budget when it runs.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { UploadAssetStatus } from "@/generated/prisma/client";
import { withAuth, withAuthValidation } from "@/lib/api/route-handler";
import { requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { BadRequestError, fromZodError, notFoundError } from "@/lib/errors";
import {
  assertUploadNoteOffered,
  getUploadNoteOffers,
  getUploadNoteStatus,
  requestUploadNote,
  uploadNoteCapability,
} from "@/lib/uploads/upload-note";

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);

const requestSchema = z
  .object({
    assetId: z.string().cuid(),
    sourceItemId: z.string().cuid().optional(),
    positionX: coordinate.optional(),
    positionY: coordinate.optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.positionX === undefined) === (value.positionY === undefined),
    { message: "positionX and positionY go together", path: ["positionY"] },
  );

const statusQuerySchema = z.object({ assetId: z.string().cuid() }).strict();

async function findEditableAsset(
  assetId: string,
  userId: string,
  email: string,
  level: "VIEW" | "EDIT",
) {
  const asset = await prisma.uploadAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      canvasId: true,
      mimeType: true,
      status: true,
      noteItemId: true,
    },
  });
  if (!asset || asset.status !== UploadAssetStatus.ACTIVE) {
    throw notFoundError("Upload", assetId);
  }
  await requireCanvasAccess(asset.canvasId, userId, email, level);
  return asset;
}

export const GET = withAuth(async (request, session) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (!params.assetId) {
    return NextResponse.json(await getUploadNoteOffers(session.user.id));
  }
  const parsed = statusQuerySchema.safeParse(params);
  if (!parsed.success) throw fromZodError(parsed.error);
  const asset = await findEditableAsset(
    parsed.data.assetId,
    session.user.id,
    session.user.email ?? "",
    "VIEW",
  );
  return NextResponse.json(await getUploadNoteStatus(prisma, asset));
});

export const POST = withAuthValidation(
  requestSchema,
  async (data, _request, session) => {
    const userId = session.user.id;
    const asset = await findEditableAsset(
      data.assetId,
      userId,
      session.user.email ?? "",
      "EDIT",
    );
    const capability = uploadNoteCapability(asset.mimeType);
    if (!capability) {
      throw new BadRequestError("This file type cannot become a note.");
    }
    if (data.sourceItemId) {
      const source = await prisma.canvasItem.findFirst({
        where: {
          id: data.sourceItemId,
          canvasId: asset.canvasId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!source) {
        throw new BadRequestError(
          "The source item is not on this upload's canvas.",
        );
      }
    }
    await assertUploadNoteOffered(userId, capability);
    const status = await requestUploadNote(prisma, {
      userId,
      assetId: asset.id,
      sourceItemId: data.sourceItemId,
      positionX: data.positionX,
      positionY: data.positionY,
    });
    return NextResponse.json(status, {
      status: status.state === "done" ? 200 : 202,
    });
  },
);
