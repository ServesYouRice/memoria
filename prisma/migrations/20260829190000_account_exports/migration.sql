CREATE TYPE "AccountExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "AccountExport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountExportStatus" NOT NULL DEFAULT 'QUEUED',
    "formatVersion" INTEGER NOT NULL DEFAULT 2,
    "storageMode" TEXT NOT NULL,
    "storageKey" TEXT,
    "byteSize" BIGINT,
    "sha256" TEXT,
    "manifest" JSONB,
    "lastError" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountExport_storageKey_key" ON "AccountExport"("storageKey");
CREATE INDEX "AccountExport_userId_createdAt_idx" ON "AccountExport"("userId", "createdAt");
CREATE INDEX "AccountExport_status_expiresAt_idx" ON "AccountExport"("status", "expiresAt");
ALTER TABLE "AccountExport" ADD CONSTRAINT "AccountExport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
