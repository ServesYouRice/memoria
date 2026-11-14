-- IMP-109: one item on several canvases.
CREATE TABLE "ItemPlacement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "positionX" DOUBLE PRECISION NOT NULL,
    "positionY" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPlacement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ItemPlacement_canvasId_idx" ON "ItemPlacement"("canvasId");

CREATE UNIQUE INDEX "ItemPlacement_itemId_canvasId_key" ON "ItemPlacement"("itemId", "canvasId");

ALTER TABLE "ItemPlacement" ADD CONSTRAINT "ItemPlacement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ItemPlacement" ADD CONSTRAINT "ItemPlacement_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
