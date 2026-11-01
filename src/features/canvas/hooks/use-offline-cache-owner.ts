"use client";

/**
 * IMP-045 — whose device copies a canvas may open.
 *
 * Online, the signed-in user (who then claims the cache, wiping anyone
 * else's copies). When the session cannot be read because the network or
 * server is unreachable, the user who last claimed the cache on this
 * browser: they did not sign out, since signing out clears it. When the
 * server answers that nobody is signed in, nobody: no copy is opened, and
 * the copies stay for that user's next sign-in.
 *
 * @module features/canvas/hooks/use-offline-cache-owner
 */

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import {
  claimOfflineCache,
  readOfflineCacheOwner,
} from "@/lib/collaboration/sync/offline-store";

export interface OfflineCacheOwner {
  userId: string | null;
  /** The server confirmed this user's session (rather than the device). */
  confirmed: boolean;
}

/** A session lookup that failed without an answer from the auth server. */
export function isUnreachableSessionError(error: unknown): boolean {
  if (!error) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status !== "number" || status === 0 || status >= 500;
}

/** Undefined until known. */
export function useOfflineCacheOwner(): OfflineCacheOwner | undefined {
  const { data, error, isPending } = useSession();
  const sessionUserId = data?.user?.id ?? null;
  const unreachable =
    !sessionUserId && !isPending && isUnreachableSessionError(error);
  const [storedOwner, setStoredOwner] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (sessionUserId) void claimOfflineCache(sessionUserId).catch(() => {});
  }, [sessionUserId]);

  useEffect(() => {
    if (!unreachable) return;
    let active = true;
    readOfflineCacheOwner().then(
      (owner) => active && setStoredOwner(owner),
      () => active && setStoredOwner(null),
    );
    return () => {
      active = false;
    };
  }, [unreachable]);

  const current: OfflineCacheOwner | undefined = sessionUserId
    ? { userId: sessionUserId, confirmed: true }
    : isPending
      ? undefined
      : unreachable
        ? storedOwner === undefined
          ? undefined
          : { userId: storedOwner, confirmed: false }
        : { userId: null, confirmed: true };

  // A refetch (for example when the network returns) is pending again for a
  // moment; keep the last answer meanwhile rather than closing the canvas.
  const [settled, setSettled] = useState(current);
  if (
    current !== undefined &&
    (settled?.userId !== current.userId ||
      settled?.confirmed !== current.confirmed)
  )
    setSettled(current);
  return current ?? settled;
}
