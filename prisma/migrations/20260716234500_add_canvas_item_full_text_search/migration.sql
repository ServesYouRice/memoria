ALTER TABLE "CanvasItem" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', COALESCE("content"->>'title', '')), 'A') ||
  setweight(to_tsvector('english', COALESCE("content"->>'text', '')), 'B') ||
  setweight(to_tsvector('english', COALESCE("content"->>'description', '')), 'C') ||
  setweight(to_tsvector('english', COALESCE("content"->>'url', '')), 'D')
) STORED;

CREATE INDEX IF NOT EXISTS "idx_canvas_item_fts"
ON "CanvasItem" USING GIN ("searchVector");

CREATE INDEX IF NOT EXISTS "idx_canvas_item_tags_gin"
ON "CanvasItem" USING GIN ("tags");
