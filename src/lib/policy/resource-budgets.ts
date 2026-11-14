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
   * Optional picture and PDF of a saved page (IMP-110). Files are charged to
   * the account's upload quota, but captures stop at half of it so they never
   * crowd out the person's own uploads.
   */
  pageCapture: {
    maxImageBytes: 3 * 1024 * 1024,
    maxPdfBytes: 8 * 1024 * 1024,
    /** Bytes the page and everything it loads may download in total. */
    maxTransferBytes: 40 * 1024 * 1024,
    /** Requests the page may make, and connections open at once. */
    maxRequests: 250,
    maxConnections: 24,
    maxPageHeightPx: 12_000,
    viewport: { width: 1280, height: 800 },
    navigationTimeoutMs: 30_000,
    settleMs: 5_000,
    totalTimeoutMs: 75_000,
    maxFilesPerAccount: Math.floor(LAUNCH_LIMITS.uploadsPerUser / 2),
    maxBytesPerAccount: Math.floor(LAUNCH_LIMITS.uploadBytesPerUser / 2),
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
  /** Video transcripts and notes (IMP-114): per video and per account. */
  videoTranscript: {
    maxBytesPerVideo: 256 * 1024,
    maxBytesPerAccount: 64 * 1024 * 1024,
    maxNotesPerVideo: 500,
    maxNoteChars: 2_000,
  },
} as const;
