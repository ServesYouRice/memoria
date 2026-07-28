export const LAUNCH_LIMITS = {
  canvasesPerUser: 200,
  workspacesPerUser: 50,
  itemsPerCanvas: 2_000,
  sharesPerCanvas: 100,
  versionsPerCanvas: 50,
  uploadsPerUser: 500,
  uploadBytesPerUser: 100 * 1024 * 1024,
  trashRetentionDays: 30,
  sharedCanvasAi: false,
} as const;
