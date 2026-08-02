ALTER TABLE "Canvas" ADD COLUMN "thumbnailKey" TEXT,
ADD COLUMN "thumbnailRevision" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "CanvasItem" ADD COLUMN "bookmarkRefreshedAt" TIMESTAMP(3);

CREATE TABLE "CanvasThumbnailCandidate" (
  "id" TEXT NOT NULL,
  "canvasId" TEXT NOT NULL,
  "revision" BIGINT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasThumbnailCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CanvasThumbnailCandidate_canvasId_revision_key" ON "CanvasThumbnailCandidate"("canvasId", "revision");
CREATE INDEX "CanvasThumbnailCandidate_createdAt_idx" ON "CanvasThumbnailCandidate"("createdAt");
ALTER TABLE "CanvasThumbnailCandidate" ADD CONSTRAINT "CanvasThumbnailCandidate_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE "Canvas" SET "thumbnail" = NULL WHERE "thumbnail" IS NOT NULL;
