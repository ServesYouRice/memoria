-- Live items are never archived: clear a stale archivedAt left by version
-- restore or the sync projection's re-create path. Soft-deleted rows are left
-- alone because a stale flag there cannot be told apart from a real archive.
UPDATE "CanvasItem" SET "archivedAt" = NULL
WHERE "deletedAt" IS NULL AND "archivedAt" IS NOT NULL;
