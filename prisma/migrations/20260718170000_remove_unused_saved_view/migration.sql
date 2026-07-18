-- SavedView was never exposed or read by the application. CanvasView is the
-- maintained organizer/view model, so retaining this empty legacy table only
-- creates schema and migration drift.
DROP TABLE IF EXISTS "SavedView";

-- API responses derive item counts from live, non-deleted rows. The legacy
-- denormalized column was never maintained and could only report stale data.
ALTER TABLE "Canvas" DROP COLUMN IF EXISTS "itemCount";
