import { LAUNCH_LIMITS } from "./launch-limits";

/**
 * Resource ceilings that are shared by the canvas, export, and collaboration
 * paths.  Keeping the values in one place makes the advertised launch scale
 * testable instead of leaving individual routes to silently choose a larger
 * limit.
 */
export const RESOURCE_BUDGETS = {
  canvas: {
    regressionItemCounts: [500, 1_000, LAUNCH_LIMITS.itemsPerCanvas] as const,
    maxItems: LAUNCH_LIMITS.itemsPerCanvas,
    geometryIndexBytes: 512 * 1024,
    viewportResponseBytes: 512 * 1024,
    viewportPageItems: 250,
    accessiblePageItems: 50,
    viewportTilePixels: 512,
    maxPanFrameMs: 16.67,
    maxEventLoopLagMs: 50,
    maxHeapGrowthBytes: 64 * 1024 * 1024,
  },
  accountExport: {
    maxUncompressedBytes: 384 * 1024 * 1024,
    maxArchiveBytes: 256 * 1024 * 1024,
    retentionMs: 24 * 60 * 60 * 1_000,
  },
  collaboration: {
    regressionClients: 50,
  },
} as const;
