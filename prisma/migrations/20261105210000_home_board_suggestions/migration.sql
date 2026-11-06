-- IMP-066: Inbox items get a suggested home board. One row per item records
-- the proposal and what the user did with it, so a dismissed suggestion is
-- never proposed again for the same item.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "autoFileItems" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "HomeBoardSuggestionStatus" AS ENUM ('OPEN', 'ACCEPTED', 'AUTO_FILED', 'DISMISSED', 'REVERTED');

-- CreateTable
CREATE TABLE "HomeBoardSuggestion" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceCanvasId" TEXT NOT NULL,
    "targetCanvasId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "HomeBoardSuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "suggestionId" TEXT,
    "changeSetId" TEXT,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBoardSuggestion_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeBoardSuggestion_suggestionId_key" ON "HomeBoardSuggestion"("suggestionId");

-- CreateIndex
CREATE INDEX "HomeBoardSuggestion_userId_sourceCanvasId_status_idx" ON "HomeBoardSuggestion"("userId", "sourceCanvasId", "status");

-- CreateIndex
CREATE INDEX "HomeBoardSuggestion_userId_status_actedAt_idx" ON "HomeBoardSuggestion"("userId", "status", "actedAt");

-- AddForeignKey
ALTER TABLE "HomeBoardSuggestion" ADD CONSTRAINT "HomeBoardSuggestion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
