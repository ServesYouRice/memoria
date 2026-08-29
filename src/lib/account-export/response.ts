import type { AccountExport } from "@/generated/prisma/client";

export function accountExportResponse(
  value: Pick<
    AccountExport,
    | "id"
    | "status"
    | "formatVersion"
    | "byteSize"
    | "sha256"
    | "manifest"
    | "lastError"
    | "cancelRequestedAt"
    | "startedAt"
    | "completedAt"
    | "expiresAt"
    | "createdAt"
    | "updatedAt"
  >,
) {
  const {
    id,
    status,
    formatVersion,
    byteSize,
    sha256,
    manifest,
    lastError,
    cancelRequestedAt,
    startedAt,
    completedAt,
    expiresAt,
    createdAt,
    updatedAt,
  } = value;
  return {
    id,
    status,
    formatVersion,
    byteSize: byteSize?.toString() ?? null,
    sha256,
    manifest,
    lastError,
    cancelRequestedAt,
    startedAt,
    completedAt,
    expiresAt,
    createdAt,
    updatedAt,
    downloadReady: status === "COMPLETED" && expiresAt.getTime() > Date.now(),
  };
}
