-- IMP-094: keep the readable text of saved pages.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "webArchiveLookup" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ItemPageCopy" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textBytes" INTEGER NOT NULL DEFAULT 0,
    "readAt" TIMESTAMP(3),
    "archiveUrl" TEXT,
    "archiveCheckedAt" TIMESTAMP(3),
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPageCopy_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE INDEX "ItemPageCopy_userId_idx" ON "ItemPageCopy"("userId");

-- CreateIndex
CREATE INDEX "idx_item_page_copy_fts" ON "ItemPageCopy" USING GIN ("searchVector");

-- AddForeignKey
ALTER TABLE "ItemPageCopy" ADD CONSTRAINT "ItemPageCopy_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fill in links saved before this change: one background job walks them in
-- pages (safe to run twice; every step is keyed).
INSERT INTO "OutboxJob" ("id", "type", "payload", "dedupeKey", "updatedAt")
VALUES (
  'imp094-page-copy-backfill',
  'link.page-copy.backfill',
  '{}'::jsonb,
  'link.page-copy.backfill:start',
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;
