-- IMP-046: version history from snapshots. Versions are either MANUAL (named by
-- a person, never expired) or AUTO (taken by the versions.auto-snapshot job and
-- thinned out by versions.auto-retention). Manual versions record who saved
-- them, and every version records a content hash so an unchanged canvas is not
-- snapshotted twice.

-- CreateEnum
CREATE TYPE "CanvasVersionKind" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "CanvasVersion"
  ADD COLUMN "kind" "CanvasVersionKind" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "contentHash" TEXT;

-- Until now only a canvas owner could save or restore a version.
UPDATE "CanvasVersion" AS version
SET "createdById" = canvas."userId"
FROM "Canvas" AS canvas
WHERE canvas."id" = version."canvasId";

-- CreateIndex
CREATE INDEX "CanvasVersion_canvasId_kind_createdAt_idx" ON "CanvasVersion"("canvasId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasVersion_createdById_idx" ON "CanvasVersion"("createdById");

-- AddForeignKey
ALTER TABLE "CanvasVersion" ADD CONSTRAINT "CanvasVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
