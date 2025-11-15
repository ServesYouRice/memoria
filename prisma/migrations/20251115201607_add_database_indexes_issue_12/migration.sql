-- Add database indexes for improved query performance (Issue #12)

-- Canvas table indexes
CREATE INDEX "Canvas_userId_isTemplate_idx" ON "Canvas"("userId", "isTemplate");
CREATE INDEX "Canvas_isPublic_idx" ON "Canvas"("isPublic");

-- CanvasItem table indexes
CREATE INDEX "CanvasItem_canvasId_createdById_idx" ON "CanvasItem"("canvasId", "createdById");

-- Comment table indexes
CREATE INDEX "Comment_itemId_createdAt_idx" ON "Comment"("itemId", "createdAt");
