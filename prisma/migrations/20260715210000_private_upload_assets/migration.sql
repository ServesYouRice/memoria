ALTER TYPE "SuggestionStatus" ADD VALUE IF NOT EXISTS 'EXECUTING' AFTER 'APPROVED';
ALTER TABLE "IdempotencyKey" ADD COLUMN IF NOT EXISTS "requestHash" TEXT;

CREATE TABLE "UploadAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageMode" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadAsset_storageKey_key" ON "UploadAsset"("storageKey");
CREATE INDEX "UploadAsset_userId_createdAt_idx" ON "UploadAsset"("userId", "createdAt");
CREATE INDEX "UploadAsset_canvasId_createdAt_idx" ON "UploadAsset"("canvasId", "createdAt");

ALTER TABLE "UploadAsset" ADD CONSTRAINT "UploadAsset_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UploadAsset" ADD CONSTRAINT "UploadAsset_canvasId_fkey"
FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
