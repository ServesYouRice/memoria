-- IMP-110: optional picture and PDF of saved pages.

-- AlterTable
ALTER TABLE "UploadAsset" ADD COLUMN "sourceItemId" TEXT;

-- CreateTable
CREATE TABLE "ItemPageCapture" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "imageAssetId" TEXT,
    "pdfAssetId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPageCapture_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE INDEX "ItemPageCapture_userId_idx" ON "ItemPageCapture"("userId");

-- CreateIndex
CREATE INDEX "UploadAsset_sourceItemId_idx" ON "UploadAsset"("sourceItemId");

-- AddForeignKey
ALTER TABLE "ItemPageCapture" ADD CONSTRAINT "ItemPageCapture_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
