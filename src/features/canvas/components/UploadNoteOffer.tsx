"use client";

/**
 * IMP-071: "Make a note from this" for a selected uploaded image, and a
 * voice-note recorder. Each is shown only when the saved AI provider can read
 * images or transcribe audio; the server checks again either way.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Fab,
  Snackbar,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Mic as MicIcon,
  NoteAdd as NoteAddIcon,
  Stop as StopIcon,
} from "@mui/icons-material";
import { ItemType, type CanvasItem } from "@/types/canvas";
import {
  requestUploadNote,
  uploadAssetIdFromUrl,
  uploadVoiceNote,
  useUploadNoteOffers,
  useUploadNoteTracker,
} from "@/features/canvas/hooks/use-upload-notes";

// Upload limit is 5 MB; at 32 kbit/s ten minutes is about 2.4 MB.
const MAX_RECORDING_MS = 10 * 60 * 1000;
const RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
];

interface UploadNoteOfferProps {
  canvasId: string;
  canEdit: boolean;
  selectedItem: CanvasItem | null;
  /** Canvas coordinates of the viewport centre, for a new voice note. */
  getViewportCenter: () => { x: number; y: number };
}

function pickRecordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function UploadNoteOffer({
  canvasId,
  canEdit,
  selectedItem,
  getViewportCenter,
}: UploadNoteOfferProps) {
  const offers = useUploadNoteOffers(canEdit);
  const tracker = useUploadNoteTracker(canvasId);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(false);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);

  const imageAssetId =
    selectedItem?.type === ItemType.IMAGE
      ? uploadAssetIdFromUrl(
          (selectedItem.content as { url?: unknown } | null)?.url,
        )
      : null;

  const makeNoteFromImage = useCallback(async () => {
    if (!selectedItem || !imageAssetId) return;
    setBusy(true);
    try {
      const status = await requestUploadNote({
        assetId: imageAssetId,
        sourceItemId: selectedItem.id,
        positionX: selectedItem.positionX + selectedItem.width + 24,
        positionY: selectedItem.positionY,
      });
      tracker.track(imageAssetId, status);
    } catch (error) {
      tracker.fail(error);
    } finally {
      setBusy(false);
    }
  }, [imageAssetId, selectedItem, tracker]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    // Set in the effect body so StrictMode's mount/unmount/mount ends true.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Leaving the canvas mid-recording discards it.
      cancelledRef.current = true;
      recorderRef.current?.stop();
    };
  }, []);

  const startRecording = useCallback(async () => {
    const mimeType = pickRecordingType();
    if (!navigator.mediaDevices?.getUserMedia || mimeType === undefined) {
      tracker.fail(new Error("This browser cannot record audio."));
      return;
    }
    // One acquisition at a time: repeated clicks while the permission prompt
    // is open must not create a second recorder.
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    setStarting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (mountedRef.current) {
        tracker.fail(new Error("Microphone access was not allowed."));
      }
      return;
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setStarting(false);
    }
    if (!mountedRef.current) {
      // Unmounted while waiting: no Stop control or timeout would exist.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 32_000,
    });
    const chunks: Blob[] = [];
    const center = getViewportCenter();
    cancelledRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(false);
      if (cancelledRef.current || chunks.length === 0) return;
      setBusy(true);
      try {
        const { assetId, note } = await uploadVoiceNote({
          canvasId,
          recording: new Blob(chunks, { type: recorder.mimeType || mimeType }),
          positionX: center.x - 160,
          positionY: center.y - 100,
        });
        tracker.track(assetId, note);
      } catch (error) {
        tracker.fail(error);
      } finally {
        setBusy(false);
      }
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setElapsed(0);
    setRecording(true);
  }, [canvasId, getViewportCenter, tracker]);

  if (!canEdit) return null;

  return (
    <>
      <Box
        sx={{
          position: "absolute",
          right: 88,
          bottom: 20,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        {offers.readImage && imageAssetId && !recording && (
          <Button
            variant="contained"
            color="secondary"
            size="small"
            startIcon={<NoteAddIcon />}
            onClick={makeNoteFromImage}
            disabled={busy}
          >
            Make a note from this
          </Button>
        )}
        {recording && (
          <Typography
            role="status"
            variant="body2"
            sx={{
              px: 1,
              py: 0.5,
              borderRadius: 1,
              bgcolor: "background.paper",
              boxShadow: 1,
            }}
          >
            Recording {formatElapsed(elapsed)}
          </Typography>
        )}
        {offers.speechToText && (
          <Tooltip title={recording ? "Stop and make a note" : "Voice note"}>
            <span>
              <Fab
                size="medium"
                color={recording ? "error" : "default"}
                aria-label={
                  recording ? "Stop recording voice note" : "Record voice note"
                }
                onClick={
                  recording ? () => recorderRef.current?.stop() : startRecording
                }
                disabled={(busy || starting) && !recording}
              >
                {recording ? <StopIcon /> : <MicIcon />}
              </Fab>
            </span>
          </Tooltip>
        )}
      </Box>
      <Snackbar
        open={Boolean(tracker.message)}
        autoHideDuration={tracker.message?.severity === "info" ? null : 6000}
        onClose={tracker.clearMessage}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {tracker.message ? (
          <Alert
            severity={tracker.message.severity}
            onClose={tracker.clearMessage}
            variant="filled"
          >
            {tracker.message.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
