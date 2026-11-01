/**
 * IMP-046 — automatic version history policy.
 *
 * An automatic snapshot is taken at most once per `AUTO_SNAPSHOT_INTERVAL_MS`
 * for a canvas that changed since its latest version. Automatic snapshots are
 * thinned out as they age; manual versions are never touched.
 *
 * @module lib/versions/policy
 */

export const AUTO_SNAPSHOT_JOB = "versions.auto-snapshot";
export const AUTO_RETENTION_JOB = "versions.auto-retention";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Minimum time between two versions of one canvas when one is automatic. */
export const AUTO_SNAPSHOT_INTERVAL_MS = 10 * MINUTE_MS;
/** How often the scheduler asks for a sweep (also the job dedupe bucket). */
export const AUTO_SNAPSHOT_SWEEP_MS = 5 * MINUTE_MS;
/**
 * A canvas is only a candidate while its last change is this recent, which
 * bounds the work spent on a canvas whose writes never change its content.
 */
export const AUTO_SNAPSHOT_ACTIVITY_WINDOW_MS = DAY_MS;
/** Canvases examined per sweep; the rest are picked up by the next one. */
export const AUTO_SNAPSHOT_BATCH = 25;

/** Automatic snapshots newer than this are all kept. */
export const AUTO_KEEP_ALL_MS = DAY_MS;
/** Older than `AUTO_KEEP_ALL_MS`, one per hour is kept for this long. */
export const AUTO_KEEP_HOURLY_MS = 7 * DAY_MS;
/** Older than `AUTO_KEEP_HOURLY_MS`, one per day is kept for this long. */
export const AUTO_KEEP_DAILY_MS = 30 * DAY_MS;
/** Rows removed per statement and statements per retention run. */
export const AUTO_RETENTION_BATCH = 500;
export const AUTO_RETENTION_MAX_ROUNDS = 10;

/** Finished sweep jobs are pruned once their dedupe window is long past. */
export const VERSION_JOB_RETENTION_MS = 2 * DAY_MS;

export function autoSnapshotName(now: Date): string {
  return `Auto-save ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Dedupe keys: one sweep per `AUTO_SNAPSHOT_SWEEP_MS`, one thinning per hour. */
export function autoSnapshotDedupeKey(now: Date): string {
  return `${AUTO_SNAPSHOT_JOB}:${Math.floor(now.getTime() / AUTO_SNAPSHOT_SWEEP_MS)}`;
}

export function autoRetentionDedupeKey(now: Date): string {
  return `${AUTO_RETENTION_JOB}:${Math.floor(now.getTime() / HOUR_MS)}`;
}
