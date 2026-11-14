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
  /** Saved page text (IMP-094): what one link and one account may keep. */
  pageCopy: {
    maxBytesPerLink: 256 * 1024,
    maxBytesPerAccount: 64 * 1024 * 1024,
  },
  /**
   * PDFs on the canvas (IMP-113). A file up to `maxFileBytes` is stored and
   * counts toward the upload allowance; its text is read only when it is at
   * most `maxReadBytes` and `maxPages`, within `readTimeoutMs` and a reader
   * heap of `readHeapMb`. Up to `maxTextBytesPerFile` of text is kept in the
   * saved-text store, which shares the page-copy account budget.
   */
  pdf: {
    maxFileBytes: 20 * 1024 * 1024,
    maxReadBytes: 10 * 1024 * 1024,
    maxPages: 300,
    readTimeoutMs: 30_000,
    readHeapMb: 256,
    maxTextBytesPerFile: 1024 * 1024,
  },
} as const;
