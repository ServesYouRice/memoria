CREATE TABLE "CanvasEvent" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "canvasId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityVersion" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "permissionScope" TEXT NOT NULL DEFAULT 'VIEW',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanvasEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CanvasEvent_sequence_key" ON "CanvasEvent"("sequence");
CREATE INDEX "CanvasEvent_canvasId_sequence_idx" ON "CanvasEvent"("canvasId", "sequence");
CREATE INDEX "CanvasEvent_createdAt_idx" ON "CanvasEvent"("createdAt");
