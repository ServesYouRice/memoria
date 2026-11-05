-- IMP-064: saved links name, tag and explain themselves. One row per enriched
-- item records the values present at save time and which fields the
-- background job filled, so a rerun never overwrites the user's edits.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "autoEnrichLinks" BOOLEAN NOT NULL DEFAULT true;

-- CreateEnum
CREATE TYPE "ItemEnrichmentStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "ItemEnrichment" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ItemEnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "baseTitle" TEXT,
    "baseTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "titleLocked" BOOLEAN NOT NULL DEFAULT false,
    "filledFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filledTitle" TEXT,
    "filledTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiSkipReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemEnrichment_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE INDEX "ItemEnrichment_userId_status_idx" ON "ItemEnrichment"("userId", "status");

-- CreateIndex
CREATE INDEX "ItemEnrichment_userId_completedAt_idx" ON "ItemEnrichment"("userId", "completedAt");

-- AddForeignKey
ALTER TABLE "ItemEnrichment" ADD CONSTRAINT "ItemEnrichment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
