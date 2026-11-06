"use client";

/**
 * Client side of "voice and photos become tidy notes" (IMP-071): what the
 * saved AI provider can offer, and asking for a note from an upload.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";

export interface UploadNoteOffers {
  readImage: boolean;
  speechToText: boolean;
}

interface UploadNoteStatus {
  state: "none" | "pending" | "done" | "failed";
  noteItemId: string | null;
  error: string | null;
}

const NO_OFFERS: UploadNoteOffers = { readImage: false, speechToText: false };
const UPLOAD_URL = /^\/api\/v1\/uploads\/(c[a-z0-9]{20,})$/i;
const POLL_MS = 3_000;
const POLL_LIMIT = 80;

/** The private upload id behind an image item's URL, if it has one. */
export function uploadAssetIdFromUrl(url: unknown): string | null {
  return typeof url === "string" ? (UPLOAD_URL.exec(url)?.[1] ?? null) : null;
}

async function problemDetail(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    detail?: string;
    error?: string;
  } | null;
  return body?.detail || body?.error || fallback;
}

/** Offers follow the saved provider; nothing is offered until it answers. */
export function useUploadNoteOffers(enabled = true): UploadNoteOffers {
  const query = useQuery({
    queryKey: ["upload-note-offers"],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<UploadNoteOffers> => {
      const response = await fetch("/api/v1/upload/note");
      if (!response.ok) return NO_OFFERS;
      return (await response.json()) as UploadNoteOffers;
    },
  });
  return query.data ?? NO_OFFERS;
}

export async function requestUploadNote(input: {
  assetId: string;
  sourceItemId?: string;
  positionX?: number;
  positionY?: number;
}): Promise<UploadNoteStatus> {
  const response = await fetch("/api/v1/upload/note", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await problemDetail(response, "Could not make a note"));
  }
  return (await response.json()) as UploadNoteStatus;
}

/** Upload a recording as a voice note; the server queues its note. */
export async function uploadVoiceNote(input: {
  canvasId: string;
  recording: Blob;
  positionX: number;
  positionY: number;
}): Promise<{ assetId: string; note: UploadNoteStatus }> {
  const type = input.recording.type.split(";")[0] || "audio/webm";
  const extension = type.includes("mp4")
    ? "m4a"
    : type.includes("ogg")
      ? "ogg"
      : "webm";
  const form = new FormData();
  form.append("canvasId", input.canvasId);
  form.append("purpose", "voice-note");
  form.append("positionX", String(Math.round(input.positionX)));
  form.append("positionY", String(Math.round(input.positionY)));
  form.append("file", input.recording, `voice-note.${extension}`);
  const response = await fetch("/api/v1/upload", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(
      await problemDetail(response, "Could not upload the recording"),
    );
  }
  return response.json();
}

const UPLOAD_NOTE_EVENT = "memoria:upload-note";

interface UploadNoteAnnouncement {
  assetId: string;
  request: Promise<UploadNoteStatus>;
}

/**
 * Hand a note request made elsewhere (the image dialog) to the canvas's
 * tracker, which outlives the dialog.
 */
export function announceUploadNote(
  assetId: string,
  request: Promise<UploadNoteStatus>,
) {
  // Handled even if no tracker is mounted to report it.
  request.catch(() => undefined);
  window.dispatchEvent(
    new CustomEvent<UploadNoteAnnouncement>(UPLOAD_NOTE_EVENT, {
      detail: { assetId, request },
    }),
  );
}

/**
 * Follows queued notes until they are made (the note then arrives through
 * the canvas's committed events) and exposes one status line for the UI.
 */
export function useUploadNoteTracker(canvasId: string) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{
    text: string;
    severity: "info" | "success" | "error";
  } | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const track = useCallback(
    (assetId: string, status: UploadNoteStatus) => {
      const settle = (next: UploadNoteStatus) => {
        if (next.state === "done") {
          setMessage({ text: "Your note is ready.", severity: "success" });
          void queryClient.invalidateQueries({
            queryKey: canvasItemKeys.list(canvasId),
          });
          return true;
        }
        if (next.state === "failed") {
          setMessage({
            text: next.error
              ? `Could not make the note: ${next.error}`
              : "Could not make the note.",
            severity: "error",
          });
          return true;
        }
        return false;
      };
      if (settle(status)) return;
      setMessage({ text: "Making a note…", severity: "info" });
      let polls = 0;
      const poll = () => {
        const timer = setTimeout(async () => {
          timers.current.delete(timer);
          polls += 1;
          try {
            const response = await fetch(
              `/api/v1/upload/note?assetId=${encodeURIComponent(assetId)}`,
            );
            if (response.ok && settle(await response.json())) return;
          } catch {
            // Keep polling; a dropped request is not a failed note.
          }
          if (polls < POLL_LIMIT) poll();
        }, POLL_MS);
        timers.current.add(timer);
      };
      poll();
    },
    [canvasId, queryClient],
  );

  const fail = useCallback((error: unknown) => {
    setMessage({
      text: error instanceof Error ? error.message : "Could not make a note.",
      severity: "error",
    });
  }, []);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const { assetId, request } = (
        event as CustomEvent<UploadNoteAnnouncement>
      ).detail;
      request.then((status) => track(assetId, status)).catch(fail);
    };
    window.addEventListener(UPLOAD_NOTE_EVENT, onAnnounce);
    return () => window.removeEventListener(UPLOAD_NOTE_EVENT, onAnnounce);
  }, [fail, track]);

  return {
    message,
    clearMessage: () => setMessage(null),
    track,
    fail,
  };
}
