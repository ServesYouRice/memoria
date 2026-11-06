-- IMP-065: "you saved this already". Bookmarks saved by a clip, a clip batch
-- or inbox_save carry their normalized URL for an indexed exact-duplicate
-- lookup; link enrichment records near-duplicates found with embeddings.

-- AlterTable
ALTER TABLE "CanvasItem" ADD COLUMN "normalizedUrl" TEXT;

-- AlterTable
ALTER TABLE "ItemEnrichment" ADD COLUMN "similarItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "CanvasItem_normalizedUrl_idx" ON "CanvasItem"("normalizedUrl");
