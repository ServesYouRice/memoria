-- IMP-042: collaborative canvas documents. One Yjs document per canvas, owned
-- by the sync server; accepted updates are appended in the same transaction
-- that projects them onto CanvasItem rows. Existing canvases migrate lazily on
-- first open. Version snapshots additionally keep the Yjs state they came from.

-- AlterTable
ALTER TABLE "CanvasVersion" ADD COLUMN     "yjsState" BYTEA;

-- CreateTable
CREATE TABLE "CanvasDocument" (
    "canvasId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "compactedThrough" BIGINT NOT NULL DEFAULT 0,
    "eventSequence" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasDocument_pkey" PRIMARY KEY ("canvasId")
);

-- CreateTable
CREATE TABLE "CanvasDocumentUpdate" (
    "id" BIGSERIAL NOT NULL,
    "canvasId" TEXT NOT NULL,
    "update" BYTEA NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasDocumentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanvasDocumentUpdate_canvasId_id_idx" ON "CanvasDocumentUpdate"("canvasId", "id");

-- AddForeignKey
ALTER TABLE "CanvasDocument" ADD CONSTRAINT "CanvasDocument_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasDocumentUpdate" ADD CONSTRAINT "CanvasDocumentUpdate_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "CanvasDocument"("canvasId") ON DELETE CASCADE ON UPDATE CASCADE;
