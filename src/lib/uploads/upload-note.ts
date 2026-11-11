/**
 * Voice and photos become tidy notes (IMP-071).
 *
 * A request enqueues one `upload.note` outbox job per upload. The job reads
 * the original from private storage, transcribes it (audio) or reads it
 * (image) on the requester's saved AI provider within their AI budget, and
 * creates a titled text note next to the original that links back to it. The
 * original upload is never changed or removed.
 *
 * Safe to run twice: the note id is written to `UploadAsset.noteItemId` in the
 * same transaction that creates the note, under the canvas mutation lock, and
 * a job that finds it set does nothing.
 */

import {
  ItemType,
  OutboxJobStatus,
  ShareRole,
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { z } from "zod";
import { ApiError, ServiceUnavailableError } from "@/lib/errors";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { assertCanvasItemCapacity } from "@/lib/policy/capacity";
import { findOpenSlot } from "@/lib/agents/inbox";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { getAiAvailability } from "@/lib/ai/provider-resolution";
import { isAiEnabled, runBudgetedAi } from "@/lib/ai/budget";
import {
  AiBudgetError,
  AiDisabledError,
  AiProviderError,
} from "@/lib/ai/errors";
import { generateText, readImageText, transcribeAudio } from "@/lib/ai/service";
import { readPrivateUploadObject } from "./private-storage";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
} from "./file-types";
import { buildNoteDocument, parseNoteDraft } from "./note-draft";

export const UPLOAD_NOTE_JOB = "upload.note";
/** Transcription and vision calls are slower than a chat reply. */
export const UPLOAD_NOTE_TIMEOUT_MS = 180_000;
export const UPLOAD_NOTE_TAG = "ai-generated";

const NOTE_WIDTH = 320;
const NOTE_GAP = 24;
const MAX_READ_BYTES = 6 * 1024 * 1024;
const NOTE_OUTPUT_TOKENS = 1_500;
// Budget reservations take a prompt string; image and audio input is billed
// on top of the text, so these estimates are reserved as extra tokens.
const IMAGE_INPUT_TOKEN_ESTIMATE = 1_600;
const AUDIO_TOKENS_PER_KIB = 1;
const MAX_TRANSCRIPT_PROMPT_BYTES = 48 * 1024;

export type UploadNoteCapability = "speechToText" | "readImage";

export function uploadNoteCapability(
  mimeType: string,
): UploadNoteCapability | null {
  if ((ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mimeType))
    return "speechToText";
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType))
    return "readImage";
  return null;
}

export function uploadNoteDedupeKey(assetId: string) {
  return `${UPLOAD_NOTE_JOB}:${assetId}`;
}

export interface UploadNoteOffers {
  readImage: boolean;
  speechToText: boolean;
}

/** What the UI may offer this user. Secret-free. */
export async function getUploadNoteOffers(
  userId: string,
): Promise<UploadNoteOffers> {
  if (!isAiEnabled()) return { readImage: false, speechToText: false };
  const availability = await getAiAvailability(userId);
  return {
    readImage: Boolean(availability.capabilities?.readImage),
    speechToText: Boolean(availability.capabilities?.speechToText),
  };
}

export async function assertUploadNoteOffered(
  userId: string,
  capability: UploadNoteCapability,
) {
  if (!isAiEnabled()) throw new AiDisabledError();
  const offers = await getUploadNoteOffers(userId);
  if (!offers[capability]) {
    throw new ServiceUnavailableError(
      capability === "speechToText"
        ? "Your saved AI provider cannot transcribe audio. Choose OpenAI or a local Whisper-compatible server in Settings."
        : "Your saved AI provider cannot read images.",
    );
  }
}

export const uploadNoteJobPayloadSchema = z
  .object({
    assetId: z.string().cuid(),
    requestedById: z.string().min(1),
    sourceItemId: z.string().cuid().optional(),
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
  })
  .strict();

export type UploadNoteJobPayload = z.infer<typeof uploadNoteJobPayloadSchema>;

export type UploadNoteState = "none" | "pending" | "done" | "failed";

export interface UploadNoteStatus {
  state: UploadNoteState;
  noteItemId: string | null;
  error: string | null;
}

type Store = Prisma.TransactionClient | PrismaClient;

async function liveNoteId(store: Store, noteItemId: string | null) {
  if (!noteItemId) return null;
  const note = await store.canvasItem.findFirst({
    where: { id: noteItemId, deletedAt: null },
    select: { id: true },
  });
  return note?.id ?? null;
}

export async function getUploadNoteStatus(
  store: Store,
  asset: { id: string; noteItemId: string | null },
): Promise<UploadNoteStatus> {
  if (asset.noteItemId) {
    return {
      state: "done",
      noteItemId: await liveNoteId(store, asset.noteItemId),
      error: null,
    };
  }
  const job = await store.outboxJob.findUnique({
    where: { dedupeKey: uploadNoteDedupeKey(asset.id) },
    select: { status: true, lastError: true },
  });
  if (!job) return { state: "none", noteItemId: null, error: null };
  if (job.status === OutboxJobStatus.DEAD) {
    return { state: "failed", noteItemId: null, error: job.lastError };
  }
  if (job.status === OutboxJobStatus.COMPLETED) {
    // Completed without a note: the upload went away before it ran.
    return { state: "failed", noteItemId: null, error: job.lastError };
  }
  return { state: "pending", noteItemId: null, error: null };
}

/**
 * Enqueue (or re-arm) the note job for an upload the caller may edit. The
 * caller has checked canvas EDIT access and the provider capability.
 *
 * - A live note already made from this upload is returned as is.
 * - A note that was deleted, or a job that failed for good, is retried by
 *   clearing the recorded note and putting the same job back to PENDING.
 */
export async function requestUploadNote(
  prisma: PrismaClient,
  input: Omit<UploadNoteJobPayload, "requestedById"> & { userId: string },
): Promise<UploadNoteStatus> {
  const payload = uploadNoteJobPayloadSchema.parse({
    assetId: input.assetId,
    requestedById: input.userId,
    sourceItemId: input.sourceItemId,
    positionX: input.positionX,
    positionY: input.positionY,
  });
  return prisma.$transaction(async (tx) => {
    const asset = await tx.uploadAsset.findUnique({
      where: { id: payload.assetId },
      select: { id: true, canvasId: true, noteItemId: true },
    });
    if (!asset) throw new Error("Upload disappeared during note request");
    await lockCanvasForMutation(tx, asset.canvasId);
    const current = await tx.uploadAsset.findUniqueOrThrow({
      where: { id: asset.id },
      select: { id: true, noteItemId: true },
    });
    const existing = await liveNoteId(tx, current.noteItemId);
    if (existing) return { state: "done", noteItemId: existing, error: null };
    if (current.noteItemId) {
      await tx.uploadAsset.update({
        where: { id: asset.id },
        data: { noteItemId: null },
      });
    }

    const dedupeKey = uploadNoteDedupeKey(asset.id);
    const job = await tx.outboxJob.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true },
    });
    if (!job) {
      await enqueueOutboxJob(tx, {
        type: UPLOAD_NOTE_JOB,
        dedupeKey,
        maxAttempts: 4,
        payload,
      });
    } else if (
      job.status === OutboxJobStatus.DEAD ||
      job.status === OutboxJobStatus.COMPLETED
    ) {
      await tx.outboxJob.update({
        where: { id: job.id },
        data: {
          status: OutboxJobStatus.PENDING,
          payload: payload as Prisma.InputJsonValue,
          attempts: 0,
          nextRunAt: new Date(),
          completedAt: null,
          lastError: null,
        },
      });
    }
    return { state: "pending", noteItemId: null, error: null };
  });
}

/** A failure the outbox should not retry (budget, settings, bad input). */
export class UploadNoteJobError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UploadNoteJobError";
  }
}

function toJobError(error: unknown): unknown {
  if (error instanceof UploadNoteJobError) return error;
  if (error instanceof AiBudgetError) {
    // A busy slot clears in seconds; a daily allowance does not.
    const retryable = error.extensions?.code === "AI_CONCURRENCY_BUDGET";
    return new UploadNoteJobError(error.detail ?? error.title, retryable);
  }
  if (error instanceof AiProviderError) {
    const keyRejected = /rejected the saved key/.test(error.detail ?? "");
    return new UploadNoteJobError(error.detail ?? error.title, !keyRejected);
  }
  if (error instanceof ApiError) {
    // Not configured, capability missing, AI disabled, unusable base URL.
    return new UploadNoteJobError(error.detail ?? error.title, false);
  }
  return error;
}

async function readOriginal(
  storageMode: string,
  storageKey: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const object = await readPrivateUploadObject(storageMode, storageKey);
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Upload read aborted");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_READ_BYTES) {
        throw new UploadNoteJobError("Upload is larger than allowed", false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

const IMAGE_SYSTEM =
  "You turn photos of written material (receipts, whiteboards, book pages, handwritten notes, slides, signs) into clean, well-organized text notes. You never invent content that is not in the image.";
const IMAGE_PROMPT = `Read this image and write it up as a tidy note.
Reply with a short title on the first line (under 60 characters), then a blank line, then the note.
Write plain text: no markdown headings or bold. Use "- " for list items and keep line items, amounts, dates and names exactly as shown.
If there is no readable text, describe in one or two sentences what the image shows.`;

const VOICE_SYSTEM =
  "You tidy up transcripts of voice notes into clean text notes. Keep the speaker's meaning and every fact, name, number and date; never add content.";

function voicePrompt(transcript: string) {
  return `Clean up this voice note transcript: fix punctuation and casing, remove filler words, false starts and repetitions, and split it into short paragraphs or "- " list items where the speaker lists things.
Reply with a short title on the first line (under 60 characters), then a blank line, then the note. Write plain text: no markdown headings or bold.

Transcript:
"""
${transcript}
"""`;
}

function truncateUtf8(value: string, maxBytes: number) {
  const bytes = Buffer.from(value, "utf8");
  return bytes.length <= maxBytes
    ? value
    : bytes.subarray(0, maxBytes).toString("utf8");
}

async function writeUp(
  payload: UploadNoteJobPayload,
  asset: { mimeType: string; filename: string; size: number },
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<string> {
  const capability = uploadNoteCapability(asset.mimeType);
  const userId = payload.requestedById;
  if (capability === "readImage") {
    const { value } = await runBudgetedAi(
      userId,
      {
        prompt: `${IMAGE_SYSTEM}\n${IMAGE_PROMPT}`,
        maxOutputTokens: NOTE_OUTPUT_TOKENS + IMAGE_INPUT_TOKEN_ESTIMATE,
      },
      () =>
        readImageText({
          userId,
          image: bytes,
          mimeType: asset.mimeType,
          prompt: IMAGE_PROMPT,
          system: IMAGE_SYSTEM,
          maxTokens: NOTE_OUTPUT_TOKENS,
          signal,
        }),
    );
    return value;
  }
  if (capability === "speechToText") {
    const { value: transcript } = await runBudgetedAi(
      userId,
      {
        prompt: asset.filename,
        maxOutputTokens: Math.ceil(asset.size / 1024) * AUDIO_TOKENS_PER_KIB,
      },
      () =>
        transcribeAudio({
          userId,
          audio: bytes,
          mimeType: asset.mimeType,
          filename: asset.filename,
          signal,
        }),
    );
    const spoken = transcript.trim();
    if (!spoken) return "";
    const prompt = voicePrompt(
      truncateUtf8(spoken, MAX_TRANSCRIPT_PROMPT_BYTES),
    );
    const { value } = await runBudgetedAi(
      userId,
      {
        prompt: `${VOICE_SYSTEM}\n${prompt}`,
        maxOutputTokens: NOTE_OUTPUT_TOKENS,
      },
      () =>
        generateText({
          userId,
          prompt,
          system: VOICE_SYSTEM,
          temperature: 0.2,
          maxTokens: NOTE_OUTPUT_TOKENS,
          signal,
        }),
    );
    return value;
  }
  throw new UploadNoteJobError("This file type cannot become a note", false);
}

/**
 * Owner or an EDIT share, as `getCanvasAccess` decides it. Not imported from
 * `@/lib/api/auth`: that module pulls request-scoped Next.js code into the
 * outbox worker bundle.
 */
async function canStillEdit(
  prisma: PrismaClient,
  canvasId: string,
  userId: string,
): Promise<boolean> {
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: {
      userId: true,
      shares: { where: { recipientId: userId }, select: { role: true } },
    },
  });
  if (!canvas) return false;
  return (
    canvas.userId === userId ||
    canvas.shares.some((share) => share.role === ShareRole.EDIT)
  );
}

/**
 * The same check inside the note transaction. The share revoke route does
 * not take the canvas mutation lock, so the share row is read FOR SHARE: a
 * concurrent revoke waits until this transaction has committed, and a revoke
 * that committed first leaves no row to find.
 */
async function canStillEditLocked(
  tx: Prisma.TransactionClient,
  canvasId: string,
  userId: string,
): Promise<boolean> {
  const canvas = await tx.canvas.findUnique({
    where: { id: canvasId },
    select: { userId: true },
  });
  if (!canvas) return false;
  if (canvas.userId === userId) return true;
  const shares = await tx.$queryRaw<{ role: ShareRole }[]>`
    SELECT "role" FROM "CanvasShare"
    WHERE "canvasId" = ${canvasId} AND "recipientId" = ${userId}
    FOR SHARE`;
  return shares.some((share) => share.role === ShareRole.EDIT);
}

const NO_LONGER_EDITS = "The requester can no longer edit this canvas";

function noteHeight(textLength: number) {
  return Math.min(640, Math.max(200, 120 + Math.ceil(textLength / 40) * 20));
}

export function createUploadNoteHandler(prisma: PrismaClient): OutboxHandler {
  return async (job, context) => {
    const payload = uploadNoteJobPayloadSchema.parse(job.payload);
    const asset = await prisma.uploadAsset.findUnique({
      where: { id: payload.assetId },
    });
    // Deleted or never finished: nothing to read, nothing to link to.
    if (!asset || asset.status !== UploadAssetStatus.ACTIVE) return;
    if (asset.noteItemId) return;

    // The requester may have lost edit access since asking.
    if (!(await canStillEdit(prisma, asset.canvasId, payload.requestedById))) {
      throw new UploadNoteJobError(NO_LONGER_EDITS, false);
    }

    let text: string;
    try {
      const bytes = await readOriginal(
        asset.storageMode,
        asset.storageKey,
        context?.signal,
      );
      text = await writeUp(payload, asset, bytes, context?.signal);
    } catch (error) {
      throw toJobError(error);
    }

    const isAudio = uploadNoteCapability(asset.mimeType) === "speechToText";
    const draft = parseNoteDraft(text, isAudio ? "Voice note" : "Photo note");
    const content = parseCanvasItemContent(
      ItemType.NOTE,
      buildNoteDocument({
        draft,
        originalUrl: `/api/v1/uploads/${asset.id}`,
        originalLabel: isAudio ? "voice recording" : asset.filename,
        emptyBody: isAudio
          ? "No speech was recognized in this recording."
          : "No readable text was found in this image.",
      }),
    ) as { plainText: string };

    const found = asset;
    const created = await prisma
      .$transaction(async (tx) => {
        const asset = found;
        await lockCanvasForMutation(tx, asset.canvasId);
        // Access may have been revoked during the storage read or AI call.
        if (
          !(await canStillEditLocked(tx, asset.canvasId, payload.requestedById))
        ) {
          throw new UploadNoteJobError(NO_LONGER_EDITS, false);
        }
        const current = await tx.uploadAsset.findUnique({
          where: { id: asset.id },
          select: { status: true, noteItemId: true },
        });
        if (
          !current ||
          current.status !== UploadAssetStatus.ACTIVE ||
          current.noteItemId
        )
          return null;
        await assertCanvasItemCapacity(tx, asset.canvasId, 1);

        const height = noteHeight(content.plainText.length);
        let position: { x: number; y: number } | null = null;
        if (payload.sourceItemId) {
          const source = await tx.canvasItem.findFirst({
            where: {
              id: payload.sourceItemId,
              canvasId: asset.canvasId,
              deletedAt: null,
            },
            select: { positionX: true, positionY: true, width: true },
          });
          if (source) {
            position = {
              x: source.positionX + source.width + NOTE_GAP,
              y: source.positionY,
            };
          }
        }
        if (
          !position &&
          payload.positionX !== undefined &&
          payload.positionY !== undefined
        ) {
          position = { x: payload.positionX, y: payload.positionY };
        }
        if (!position) {
          const occupied = await tx.canvasItem.findMany({
            where: { canvasId: asset.canvasId, deletedAt: null },
            select: {
              positionX: true,
              positionY: true,
              width: true,
              height: true,
            },
          });
          position = findOpenSlot(occupied, { width: NOTE_WIDTH, height });
        }

        const maxZ = await tx.canvasItem.aggregate({
          where: { canvasId: asset.canvasId, deletedAt: null },
          _max: { zIndex: true },
        });
        const note = await tx.canvasItem.create({
          data: {
            canvasId: asset.canvasId,
            type: ItemType.NOTE,
            positionX: position.x,
            positionY: position.y,
            width: NOTE_WIDTH,
            height,
            zIndex: (maxZ._max.zIndex ?? 0) + 1,
            content: content as Prisma.InputJsonValue,
            tags: [UPLOAD_NOTE_TAG, isAudio ? "voice-note" : "photo-note"],
            createdById: payload.requestedById,
            updatedById: payload.requestedById,
          },
          select: { id: true, version: true },
        });
        await tx.uploadAsset.update({
          where: { id: asset.id },
          data: { noteItemId: note.id },
        });
        await recordCanvasItemEvent(tx, {
          canvasId: asset.canvasId,
          actorId: payload.requestedById,
          itemId: note.id,
          version: note.version,
          operation: "created",
        });
        return note;
      })
      .catch((error) => {
        throw toJobError(error);
      });
    if (created) await invalidateCanvasCache(asset.canvasId);
  };
}
