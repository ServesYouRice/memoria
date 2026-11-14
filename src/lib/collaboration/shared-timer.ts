/**
 * IMP-105: the canvas timer everyone on a canvas sees.
 *
 * The server keeps one timer per canvas in memory and sends its end time, not
 * ticks, so every screen counts down to the same moment and a late joiner is
 * right at once. Nothing is written to the database; a replica forgets the
 * timer when its last person on the canvas leaves. Client-safe: the canvas
 * screen imports the types and the countdown maths.
 */
import { z } from "zod";

export const SHARED_TIMER_MIN_MS = 60_000;
export const SHARED_TIMER_MAX_MS = 24 * 60 * 60_000;
export const SHARED_TIMER_DEFAULT_MS = 15 * 60_000;

export type SharedTimerState =
  | { status: "idle"; durationMs: number; updatedAt: number }
  | {
      status: "running";
      durationMs: number;
      endsAt: number;
      updatedAt: number;
    }
  | {
      status: "paused";
      durationMs: number;
      remainingMs: number;
      updatedAt: number;
    };

export const sharedTimerCommandSchema = z.object({
  type: z.literal("timer"),
  action: z.enum(["start", "pause", "reset"]),
  durationMs: z
    .number()
    .int()
    .min(SHARED_TIMER_MIN_MS)
    .max(SHARED_TIMER_MAX_MS),
});

export type SharedTimerCommand = z.infer<typeof sharedTimerCommandSchema>;
export type SharedTimerAction = SharedTimerCommand["action"];

const sharedTimerStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("idle"),
    durationMs: z.number().finite(),
    updatedAt: z.number().finite(),
  }),
  z.object({
    status: z.literal("running"),
    durationMs: z.number().finite(),
    endsAt: z.number().finite(),
    updatedAt: z.number().finite(),
  }),
  z.object({
    status: z.literal("paused"),
    durationMs: z.number().finite(),
    remainingMs: z.number().finite(),
    updatedAt: z.number().finite(),
  }),
]);

/** A timer state from another replica or the server, or null. */
export function parseSharedTimerState(value: unknown): SharedTimerState | null {
  const parsed = sharedTimerStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Only people who can edit the canvas start, pause or reset its timer. */
export function canControlSharedTimer(
  accessLevel: "OWNER" | "EDIT" | "COMMENT" | "VIEW",
): boolean {
  return accessLevel === "OWNER" || accessLevel === "EDIT";
}

/** Milliseconds left at `now` (both on the clock that made the state). */
export function sharedTimerRemainingMs(
  state: SharedTimerState,
  now: number,
): number {
  switch (state.status) {
    case "idle":
      return state.durationMs;
    case "paused":
      return Math.max(0, state.remainingMs);
    case "running":
      return Math.max(0, state.endsAt - now);
  }
}

/**
 * The timer after `command` at server time `now`, or the same object when the
 * command changes nothing (a start while running, a pause while not running).
 */
export function applySharedTimerCommand(
  current: SharedTimerState | null,
  command: Pick<SharedTimerCommand, "action" | "durationMs">,
  now: number,
): SharedTimerState {
  const running =
    current?.status === "running" && current.endsAt > now ? current : null;
  switch (command.action) {
    case "start":
      if (running) return running;
      if (current?.status === "paused" && current.remainingMs > 0) {
        return {
          status: "running",
          durationMs: current.durationMs,
          endsAt: now + current.remainingMs,
          updatedAt: now,
        };
      }
      return {
        status: "running",
        durationMs: command.durationMs,
        endsAt: now + command.durationMs,
        updatedAt: now,
      };
    case "pause":
      if (!running) return current ?? idleTimer(command.durationMs, now);
      return {
        status: "paused",
        durationMs: running.durationMs,
        remainingMs: running.endsAt - now,
        updatedAt: now,
      };
    case "reset":
      return idleTimer(command.durationMs, now);
  }
}

function idleTimer(durationMs: number, now: number): SharedTimerState {
  return { status: "idle", durationMs, updatedAt: now };
}

/** Whether `incoming` (from another replica) replaces `current`. */
export function isNewerSharedTimer(
  current: SharedTimerState | null | undefined,
  incoming: SharedTimerState,
): boolean {
  return !current || incoming.updatedAt > current.updatedAt;
}

/** "mm:ss", or "h:mm:ss" from an hour up. */
export function formatSharedTimer(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
