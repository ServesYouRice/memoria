export const LAUNCH_LIMITS = {
  canvasesPerUser: 200,
  workspacesPerUser: 50,
  itemsPerCanvas: 2_000,
  sharesPerCanvas: 100,
  versionsPerCanvas: 50,
  versionSnapshotBytes: 8 * 1024 * 1024,
  uploadsPerUser: 500,
  uploadBytesPerUser: 100 * 1024 * 1024,
  trashRetentionDays: 30,
  sharedCanvasAi: false,
} as const;

/**
 * Workspace checkpoint retention (owner decision, TASK-150): per checkpoint
 * scope, keep at most the newest `maxPerScope` rows and none older than
 * `days`; a row over either limit is pruned. Checkpoints still named by an
 * open, approved or executing bulk suggestion are kept, since running that
 * suggestion requires its checkpoint. Canvas checkpoints are also deleted
 * with their canvas. Both limits can be overridden with
 * WORKSPACE_CHECKPOINT_RETENTION_DAYS and WORKSPACE_CHECKPOINT_MAX_PER_SCOPE.
 */
export const WORKSPACE_CHECKPOINT_RETENTION_DEFAULTS = {
  days: 90,
  maxPerScope: 50,
} as const;

function positiveIntegerEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function workspaceCheckpointRetention() {
  return {
    days: positiveIntegerEnv(
      process.env.WORKSPACE_CHECKPOINT_RETENTION_DAYS,
      WORKSPACE_CHECKPOINT_RETENTION_DEFAULTS.days,
    ),
    maxPerScope: positiveIntegerEnv(
      process.env.WORKSPACE_CHECKPOINT_MAX_PER_SCOPE,
      WORKSPACE_CHECKPOINT_RETENTION_DEFAULTS.maxPerScope,
    ),
  };
}
