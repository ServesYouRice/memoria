import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

export const ACCOUNT_EXPORT_FORMAT_VERSION = 2;
export const ACCOUNT_EXPORT_PAGE_SIZE = 100;
export const ACCOUNT_EXPORT_TIMEOUT_DEFAULT_MS = 10 * 60 * 1_000;
export const ACCOUNT_EXPORT_RETENTION_MS =
  RESOURCE_BUDGETS.accountExport.retentionMs;
export const ACCOUNT_EXPORT_SCOPES = [
  "profile",
  "workspaces",
  "ownedCanvases",
  "ownedCanvasItemsIncludingTrash",
  "ownedCanvasVersions",
  "ownedCanvasShares",
  "authoredOrOwnedCanvasComments",
  "accountActivities",
  "notificationPreferences",
  "uploadMetadata",
  "activeUploadObjects",
] as const;
export const ACCOUNT_EXPORT_EXCLUSIONS = [
  "password and session material",
  "OAuth and API credentials",
  "verification and invitation secrets",
  "model and integration credentials",
  "operational logs and derived thumbnails",
] as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function accountExportBudgets() {
  return {
    maxUncompressedBytes: positiveInteger(
      process.env.ACCOUNT_EXPORT_MAX_INPUT_BYTES,
      RESOURCE_BUDGETS.accountExport.maxUncompressedBytes,
    ),
    maxArchiveBytes: positiveInteger(
      process.env.ACCOUNT_EXPORT_MAX_ARCHIVE_BYTES,
      RESOURCE_BUDGETS.accountExport.maxArchiveBytes,
    ),
  };
}

export function accountExportTimeoutMs(): number {
  return positiveInteger(
    process.env.ACCOUNT_EXPORT_TIMEOUT_MS,
    ACCOUNT_EXPORT_TIMEOUT_DEFAULT_MS,
  );
}
