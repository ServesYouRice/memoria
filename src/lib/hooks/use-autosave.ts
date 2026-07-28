import { useCallback, useEffect, useRef, useState } from "react";
import { useUpdateCanvasItem } from "./use-canvas-items";
import { type UpdateCanvasItemInput } from "@/lib/validation/canvas-item";
import { AUTOSAVE_DEBOUNCE_MS } from "@/lib/constants";
import {
  type AutosaveStatus,
  SerializedDeltaQueue,
} from "@/lib/autosave/serialized-delta-queue";

interface UseAutosaveOptions {
  itemId: string;
  version: number;
  debounceMs?: number;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useAutosave({
  itemId,
  version,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  onSuccess,
  onError,
}: UseAutosaveOptions) {
  const updateItem = useUpdateCanvasItem();
  const mutationRef = useRef(updateItem);
  const callbacksRef = useRef({ onSuccess, onError });
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const [status, setStatus] = useState<AutosaveStatus>("saved");
  const [error, setError] = useState<Error | null>(null);
  mutationRef.current = updateItem;
  callbacksRef.current = { onSuccess, onError };

  const queueRef = useRef<SerializedDeltaQueue<UpdateCanvasItemInput> | null>(
    null,
  );
  const queueItemRef = useRef<string | null>(null);
  if (!queueRef.current || queueItemRef.current !== itemId) {
    queueItemRef.current = itemId;
    queueRef.current = new SerializedDeltaQueue(
      version,
      async (data) => mutationRef.current.mutateAsync({ itemId, data }),
      (nextStatus, nextError) => {
        setStatus(nextStatus);
        setError(nextError || null);
        if (nextStatus === "saved") callbacksRef.current.onSuccess?.();
        if (nextError) callbacksRef.current.onError?.(nextError);
      },
    );
  }

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    await queueRef.current?.flush();
  }, []);

  const saveChanges = useCallback(
    (changes: Partial<UpdateCanvasItemInput>) => {
      queueRef.current?.enqueue(changes);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        void flush().catch(() => {});
      }, debounceMs);
    },
    [debounceMs, flush],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void queueRef.current?.flush().catch(() => {});
    },
    [],
  );

  return {
    saveChanges,
    flush,
    status,
    isSaving: status === "saving",
    error,
  };
}
