/**
 * IMP-042 — who may open a canvas document, and who may change it.
 *
 * The sync server authenticates each document connection with the same
 * Better Auth session helper as every HTTP route (the session cookie arrives
 * with the WebSocket upgrade), or as a guest holding the canvas's public share
 * token. Access resolves through the presence socket's policy
 * (`resolveCollaborationAccess`): owners and EDIT shares may write, COMMENT
 * and VIEW shares and guests are read-only. Every connection is re-checked in
 * one batched query per refresh interval; a deleted session, a removed share,
 * or a revoked public link disconnects it, and a downgraded share turns it
 * read-only. A missing or expired session is reported as signed out rather
 * than as lost access, so the client keeps its device copy for the next
 * sign-in.
 *
 * @module lib/collaboration/sync/authorization
 */

import { nanoid } from "nanoid";
import type { PrismaClient } from "@/generated/prisma/client";
import { getSessionFromHeaders } from "@/lib/auth/session";
import {
  AUTHORIZATION_LEASE_MS,
  type CollaborationAccessLevel,
  resolveCollaborationAccess,
} from "@/lib/collaboration/transport-policy";
import { isCanvasDocumentName } from "./protocol";

export interface SyncConnectionContext {
  principalId: string;
  /** Better Auth session row behind the connection; absent for guests. */
  sessionId?: string;
  /** Public share token presented at connect, re-checked on refresh. */
  shareToken?: string;
  access: CollaborationAccessLevel;
  leaseExpiresAt: number;
  authorizationFailures: number;
}

export type SyncAuthorization =
  | { status: "granted"; context: SyncConnectionContext }
  /** No valid session and no share token presented. */
  | { status: "signed-out" }
  | { status: "forbidden" };

/** A refreshed connection whose session row is gone or expired. */
export const SYNC_SIGNED_OUT = "signed-out";

export function canWriteDocument(access: CollaborationAccessLevel): boolean {
  return access === "OWNER" || access === "EDIT";
}

export async function authorizeSyncConnection(
  prisma: PrismaClient,
  input: {
    documentName: string;
    headers: Headers;
    /** The provider token: a public share token, otherwise empty. */
    token: string;
    now?: number;
  },
): Promise<SyncAuthorization> {
  if (!isCanvasDocumentName(input.documentName)) return { status: "forbidden" };
  const session = await getSessionFromHeaders(input.headers, {
    refresh: false,
  });
  // Decided before the canvas is read, so it says nothing about the canvas.
  if (!session && !input.token) return { status: "signed-out" };
  const canvas = await prisma.canvas.findUnique({
    where: { id: input.documentName },
    select: {
      userId: true,
      isPublic: true,
      shareToken: true,
      shares: session
        ? { where: { recipientId: session.user.id }, select: { role: true } }
        : false,
    },
  });
  const principalId = session ? session.user.id : `guest:${nanoid(10)}`;
  const shareToken = input.token || undefined;
  const access = resolveCollaborationAccess({
    principalId,
    sessionActive: Boolean(session),
    shareToken,
    canvas,
    sharedRole: canvas?.shares?.[0]?.role,
  });
  if (!access) return { status: "forbidden" };
  return {
    status: "granted",
    context: {
      principalId,
      sessionId: session?.session.id,
      shareToken,
      access,
      leaseExpiresAt: (input.now ?? Date.now()) + AUTHORIZATION_LEASE_MS,
      authorizationFailures: 0,
    },
  };
}

/**
 * Re-resolve access for every open connection in two queries. Returns the
 * current access per context, SYNC_SIGNED_OUT where the connection's session
 * is gone or expired, or null where access was revoked.
 */
export async function refreshSyncAuthorizations(
  prisma: PrismaClient,
  connections: Array<{ canvasId: string; context: SyncConnectionContext }>,
): Promise<
  Map<
    SyncConnectionContext,
    CollaborationAccessLevel | typeof SYNC_SIGNED_OUT | null
  >
> {
  const results = new Map<
    SyncConnectionContext,
    CollaborationAccessLevel | typeof SYNC_SIGNED_OUT | null
  >();
  if (connections.length === 0) return results;

  const principalIds = Array.from(
    new Set(
      connections
        .filter(({ context }) => context.sessionId)
        .map(({ context }) => context.principalId),
    ),
  );
  const sessionIds = Array.from(
    new Set(
      connections
        .map(({ context }) => context.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );
  const canvasIds = Array.from(
    new Set(connections.map(({ canvasId }) => canvasId)),
  );
  const [canvases, sessions] = await Promise.all([
    prisma.canvas.findMany({
      where: { id: { in: canvasIds } },
      select: {
        id: true,
        userId: true,
        isPublic: true,
        shareToken: true,
        shares: {
          where: { recipientId: { in: principalIds } },
          select: { recipientId: true, role: true },
        },
      },
    }),
    // Revocation deletes Session rows, so a missing or expired row closes
    // the connection at the next refresh.
    sessionIds.length
      ? prisma.session.findMany({
          where: { id: { in: sessionIds }, expiresAt: { gt: new Date() } },
          select: { id: true, userId: true },
        })
      : Promise.resolve([]),
  ]);
  const liveSessions = new Map(
    sessions.map((session) => [session.id, session.userId]),
  );
  const canvasById = new Map(canvases.map((canvas) => [canvas.id, canvas]));

  for (const { canvasId, context } of connections) {
    const canvas = canvasById.get(canvasId);
    if (
      context.sessionId !== undefined &&
      liveSessions.get(context.sessionId) !== context.principalId
    ) {
      results.set(context, SYNC_SIGNED_OUT);
      continue;
    }
    results.set(
      context,
      resolveCollaborationAccess({
        principalId: context.principalId,
        sessionActive:
          context.sessionId !== undefined &&
          liveSessions.get(context.sessionId) === context.principalId,
        shareToken: context.shareToken,
        canvas: canvas ?? null,
        sharedRole: canvas?.shares.find(
          (share) => share.recipientId === context.principalId,
        )?.role,
      }),
    );
  }
  return results;
}
