-- Workspace checkpoint retention (owner decision for TASK-150): checkpoints
-- are deleted with the canvas they copy, so canvas-scoped rows get a real
-- foreign key. Rows whose canvas is already gone are deleted here, as the
-- cascade would have done.
ALTER TABLE "WorkspaceCheckpoint" ADD COLUMN "canvasId" TEXT;

UPDATE "WorkspaceCheckpoint" checkpoint
SET "canvasId" = checkpoint."scopeId"
FROM "Canvas" canvas
WHERE checkpoint."scopeType" = 'canvas'
  AND canvas."id" = checkpoint."scopeId";

DELETE FROM "WorkspaceCheckpoint"
WHERE "scopeType" = 'canvas' AND "canvasId" IS NULL;

CREATE INDEX "WorkspaceCheckpoint_scopeType_scopeId_createdAt_idx" ON "WorkspaceCheckpoint"("scopeType", "scopeId", "createdAt");
CREATE INDEX "WorkspaceCheckpoint_createdAt_idx" ON "WorkspaceCheckpoint"("createdAt");
CREATE INDEX "WorkspaceCheckpoint_canvasId_idx" ON "WorkspaceCheckpoint"("canvasId");

ALTER TABLE "WorkspaceCheckpoint" ADD CONSTRAINT "WorkspaceCheckpoint_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
