export const CURSOR_TICK_MS = 50;
export const AUTHORIZATION_REFRESH_INTERVAL_MS = 30_000;
export const AUTHORIZATION_LEASE_MS = 90_000;
export const AUTHORIZATION_MAX_CONSECUTIVE_FAILURES = 3;
export const REMOTE_INSTANCE_LEASE_MS = 75_000;

export const MAX_CURSOR_MESSAGES_PER_MINUTE = 1_500;
export const MAX_CONTROL_MESSAGES_PER_MINUTE = 600;

export type CollaborationAccessLevel = "OWNER" | "EDIT" | "COMMENT" | "VIEW";

export interface CollaborationAuthorizationCanvas {
  userId: string;
  isPublic: boolean;
  shareToken: string | null;
}

/** Pure authorization decision shared by the batched refresh and its tests. */
export function resolveCollaborationAccess(options: {
  principalId: string;
  expectedSessionVersion?: number;
  persistedSessionVersion?: number;
  guestShareToken?: string;
  canvas: CollaborationAuthorizationCanvas | null;
  sharedRole?: Exclude<CollaborationAccessLevel, "OWNER">;
}): CollaborationAccessLevel | null {
  const {
    principalId,
    expectedSessionVersion,
    persistedSessionVersion,
    guestShareToken,
    canvas,
    sharedRole,
  } = options;
  if (!canvas) return null;

  if (principalId.startsWith("guest:")) {
    return canvas.isPublic &&
      Boolean(guestShareToken) &&
      guestShareToken === canvas.shareToken
      ? "VIEW"
      : null;
  }

  if (
    expectedSessionVersion === undefined ||
    persistedSessionVersion !== expectedSessionVersion
  ) {
    return null;
  }
  if (canvas.userId === principalId) return "OWNER";
  return sharedRole || (canvas.isPublic ? "VIEW" : null);
}

export function authorizationLeaseMustClose(options: {
  consecutiveFailures: number;
  leaseExpiresAt: number;
  now: number;
}): boolean {
  return (
    options.consecutiveFailures >= AUTHORIZATION_MAX_CONSECUTIVE_FAILURES ||
    options.leaseExpiresAt <= options.now
  );
}

export interface MessageBudgetState {
  cursorCount: number;
  controlCount: number;
  resetAt: number;
}

export type MessageBudgetDecision = "allow" | "drop" | "terminate";

/**
 * Cursor frames are intentionally lossy and never consume the budget used by
 * chat, reactions, or awareness. A noisy pointer is therefore dropped without
 * making the durable/social parts of a collaboration session unavailable.
 */
export function consumeMessageBudget(
  state: MessageBudgetState,
  messageType: "cursor" | "awareness" | "message",
  now: number,
): MessageBudgetDecision {
  if (now >= state.resetAt) {
    state.cursorCount = 0;
    state.controlCount = 0;
    state.resetAt = now + 60_000;
  }

  if (messageType === "cursor") {
    state.cursorCount += 1;
    return state.cursorCount <= MAX_CURSOR_MESSAGES_PER_MINUTE
      ? "allow"
      : "drop";
  }

  state.controlCount += 1;
  return state.controlCount <= MAX_CONTROL_MESSAGES_PER_MINUTE
    ? "allow"
    : "terminate";
}

export interface ConnectionAdmissionLimits {
  global: number;
  perPrincipal: number;
  perClient: number;
}

export type ConnectionAdmissionResult =
  | { admitted: true }
  | { admitted: false; reason: "global" | "principal" | "client" };

/** O(1) admission accounting for the process-local WebSocket population. */
export class ConnectionAdmissionCounters {
  private total = 0;
  private readonly byPrincipal = new Map<string, number>();
  private readonly byClient = new Map<string, number>();

  tryAdmit(
    principalId: string,
    clientId: string,
    limits: ConnectionAdmissionLimits,
  ): ConnectionAdmissionResult {
    if (this.total >= limits.global) {
      return { admitted: false, reason: "global" };
    }
    if ((this.byPrincipal.get(principalId) ?? 0) >= limits.perPrincipal) {
      return { admitted: false, reason: "principal" };
    }
    if ((this.byClient.get(clientId) ?? 0) >= limits.perClient) {
      return { admitted: false, reason: "client" };
    }

    this.total += 1;
    this.byPrincipal.set(
      principalId,
      (this.byPrincipal.get(principalId) ?? 0) + 1,
    );
    this.byClient.set(clientId, (this.byClient.get(clientId) ?? 0) + 1);
    return { admitted: true };
  }

  release(principalId: string, clientId: string): void {
    if (this.total > 0) this.total -= 1;
    this.decrement(this.byPrincipal, principalId);
    this.decrement(this.byClient, clientId);
  }

  get totalConnections(): number {
    return this.total;
  }

  countForPrincipal(principalId: string): number {
    return this.byPrincipal.get(principalId) ?? 0;
  }

  countForClient(clientId: string): number {
    return this.byClient.get(clientId) ?? 0;
  }

  private decrement(counts: Map<string, number>, key: string): void {
    const next = (counts.get(key) ?? 0) - 1;
    if (next > 0) counts.set(key, next);
    else counts.delete(key);
  }
}

interface ExpiringEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Process-local projection of state published by peer instances. Publishers
 * renew their entry; a crashed instance disappears after the bounded lease.
 */
export class ExpiringCanvasInstances<T> {
  private readonly canvases = new Map<string, Map<string, ExpiringEntry<T>>>();

  upsert(
    canvasId: string,
    instanceId: string,
    value: T,
    now: number,
    leaseMs = REMOTE_INSTANCE_LEASE_MS,
  ): void {
    let instances = this.canvases.get(canvasId);
    if (!instances) {
      instances = new Map();
      this.canvases.set(canvasId, instances);
    }
    instances.set(instanceId, { value, expiresAt: now + leaseMs });
  }

  values(canvasId: string, now = Date.now()): T[] {
    const instances = this.canvases.get(canvasId);
    if (!instances) return [];
    return Array.from(instances.values())
      .filter((entry) => entry.expiresAt > now)
      .map((entry) => entry.value);
  }

  sweep(now = Date.now()): string[] {
    const changedCanvases: string[] = [];
    for (const [canvasId, instances] of this.canvases) {
      let changed = false;
      for (const [instanceId, entry] of instances) {
        if (entry.expiresAt <= now) {
          instances.delete(instanceId);
          changed = true;
        }
      }
      if (instances.size === 0) this.canvases.delete(canvasId);
      if (changed) changedCanvases.push(canvasId);
    }
    return changedCanvases;
  }

  deleteCanvas(canvasId: string): void {
    this.canvases.delete(canvasId);
  }

  get instanceCount(): number {
    let count = 0;
    for (const instances of this.canvases.values()) count += instances.size;
    return count;
  }
}

interface FixedWindowEntry {
  count: number;
  resetAt: number;
}

export class FixedWindowAdmissionBudget {
  private readonly entries = new Map<string, FixedWindowEntry>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.entries.get(key);
    const entry =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + this.windowMs }
        : current;
    entry.count += 1;
    this.entries.set(key, entry);
    return entry.count <= this.maximum;
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export type CollaborationCloseDisposition = "stop" | "retry";

const TERMINAL_CLOSE_CODES = new Set([1000, 1002, 1003, 1007, 1008, 1009]);

export function collaborationCloseDisposition(options: {
  code: number;
  opened: boolean;
  intentional: boolean;
}): CollaborationCloseDisposition {
  if (options.intentional) return "stop";
  if (!options.opened) return "stop";
  return TERMINAL_CLOSE_CODES.has(options.code) ? "stop" : "retry";
}

export function reconnectDelayMs(
  attempt: number,
  randomValue = Math.random(),
): number {
  const base = Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.max(0, Math.min(1, randomValue)) * base * 0.3;
}

/** A deterministic color keeps a user recognizable across reconnects. */
export function collaborationColorForUser(userId: string): string {
  const hash = stableStringHash(userId);
  return `hsl(${hash % 360} 72% 28%)`;
}

/** A second stable channel distinguishes users even if their hues collide. */
export function cursorIdentityVariant(userId: string): number {
  return Math.floor(stableStringHash(userId) / 360) % 4;
}

function stableStringHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
