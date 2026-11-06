-- IMP-061: a batch of links saved by the browser extension (and, from IMP-062,
-- the phone share target). The per-user idempotency key turns a retried batch
-- into a replay; the optional note says how the Inbox should sort the links.

-- CreateEnum
CREATE TYPE "ClipBatchSource" AS ENUM ('EXTENSION', 'SHARE_TARGET');

-- CreateTable
CREATE TABLE "ClipBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "source" "ClipBatchSource" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipBatchItem" (
    "batchId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ClipBatchItem_pkey" PRIMARY KEY ("batchId","itemId")
);

-- CreateIndex
CREATE INDEX "ClipBatch_canvasId_createdAt_idx" ON "ClipBatch"("canvasId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClipBatch_userId_idempotencyKey_key" ON "ClipBatch"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ClipBatchItem_itemId_idx" ON "ClipBatchItem"("itemId");

-- AddForeignKey
ALTER TABLE "ClipBatch" ADD CONSTRAINT "ClipBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipBatch" ADD CONSTRAINT "ClipBatch_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipBatchItem" ADD CONSTRAINT "ClipBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ClipBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipBatchItem" ADD CONSTRAINT "ClipBatchItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
