-- CreateTable
CREATE TABLE "CanvasEmbed" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "tokenDigest" TEXT NOT NULL,
    "allowedOrigins" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasEmbed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanvasEmbed_tokenDigest_key" ON "CanvasEmbed"("tokenDigest");

-- CreateIndex
CREATE INDEX "CanvasEmbed_canvasId_createdAt_idx" ON "CanvasEmbed"("canvasId", "createdAt");

-- AddForeignKey
ALTER TABLE "CanvasEmbed" ADD CONSTRAINT "CanvasEmbed_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
