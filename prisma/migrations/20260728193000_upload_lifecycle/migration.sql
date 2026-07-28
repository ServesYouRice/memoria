CREATE TYPE "UploadAssetStatus" AS ENUM ('PENDING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED', 'RECONCILING');
ALTER TABLE "UploadAsset"
  ADD COLUMN "status" "UploadAssetStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "lastError" TEXT;
UPDATE "UploadAsset" SET "status" = 'ACTIVE';

CREATE TABLE "UploadQuota" (
  "userId" TEXT NOT NULL,
  "assetCount" INTEGER NOT NULL DEFAULT 0,
  "totalBytes" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadQuota_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UploadQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UploadQuota_nonnegative_check" CHECK ("assetCount" >= 0 AND "totalBytes" >= 0)
);

INSERT INTO "UploadQuota" ("userId", "assetCount", "totalBytes", "updatedAt")
SELECT "userId", COUNT(*)::int, COALESCE(SUM("size"), 0), NOW()
FROM "UploadAsset" WHERE "status" = 'ACTIVE' GROUP BY "userId";

CREATE INDEX "UploadAsset_status_createdAt_idx" ON "UploadAsset"("status", "createdAt");
