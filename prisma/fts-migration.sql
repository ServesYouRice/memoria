/**
 * Full-Text Search Migration Script
 * 
 * Run this SQL in your PostgreSQL database to enable FTS for CanvasItem.
 * 
 * Usage:
 * 1. Connect to your PostgreSQL database
 * 2. Run the SQL in fts-migration.sql
 * 3. Or use: psql $DATABASE_URL -f prisma/fts-migration.sql
 */

-- Add PostgreSQL Full-Text Search for CanvasItem
-- This migration adds a GIN index for fast text search on JSON content fields

-- Create a generated tsvector column for efficient text search
-- This combines text, title, and description from the JSON content field
-- Using weights: A (title) > B (text) > C (description) > D (url/other)
ALTER TABLE "CanvasItem" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', COALESCE("content"->>'title', '')), 'A') ||
  setweight(to_tsvector('english', COALESCE("content"->>'text', '')), 'B') ||
  setweight(to_tsvector('english', COALESCE("content"->>'description', '')), 'C') ||
  setweight(to_tsvector('english', COALESCE("content"->>'url', '')), 'D')
) STORED;

-- Create GIN index on the search vector for fast lookups
CREATE INDEX IF NOT EXISTS "idx_canvas_item_fts" ON "CanvasItem" USING GIN ("searchVector");

-- Add GIN index on tags for array containment queries (if not exists)
CREATE INDEX IF NOT EXISTS "idx_canvas_item_tags_gin" ON "CanvasItem" USING GIN ("tags");

-- Verify the indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'CanvasItem' 
AND indexname IN ('idx_canvas_item_fts', 'idx_canvas_item_tags_gin');
