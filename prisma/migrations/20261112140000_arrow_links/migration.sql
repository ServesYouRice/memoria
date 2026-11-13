-- IMP-095: arrows are the one source of truth for "these two items are
-- linked". An ARROW item whose content names a live `startItemId` and
-- `endItemId` on its own canvas backs exactly one "ItemConnection" row; the
-- triggers below keep the rows in step inside the writing transaction, so
-- every write path (HTTP, live co-editing, undo, version restore, trash,
-- moves between canvases) agrees. Links never cross canvases.

CREATE OR REPLACE FUNCTION memoria_sync_arrow_link(p_canvas TEXT, p_from TEXT, p_to TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_label TEXT;
  v_style TEXT;
  v_found BOOLEAN := false;
BEGIN
  IF p_canvas IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RETURN;
  END IF;

  SELECT NULLIF(btrim(a."content"->>'label'), ''),
    COALESCE(a."content"->>'lineStyle', 'SOLID'), true
    INTO v_label, v_style, v_found
  FROM "CanvasItem" a
  WHERE a."canvasId" = p_canvas
    AND a."type" = 'ARROW'
    AND a."deletedAt" IS NULL
    AND a."content"->>'startItemId' = p_from
    AND a."content"->>'endItemId' = p_to
  ORDER BY a."createdAt", a."id"
  LIMIT 1;

  IF v_found
    AND EXISTS (
      SELECT 1 FROM "CanvasItem" f
      WHERE f."id" = p_from AND f."canvasId" = p_canvas
        AND f."deletedAt" IS NULL AND f."type" <> 'ARROW'
    )
    AND EXISTS (
      SELECT 1 FROM "CanvasItem" t
      WHERE t."id" = p_to AND t."canvasId" = p_canvas
        AND t."deletedAt" IS NULL AND t."type" <> 'ARROW'
    )
  THEN
    INSERT INTO "ItemConnection" ("id", "canvasId", "fromId", "toId", "label", "style", "createdAt")
    VALUES (
      'lnk' || replace(gen_random_uuid()::text, '-', ''),
      p_canvas, p_from, p_to, v_label, v_style, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("canvasId", "fromId", "toId") DO UPDATE
      SET "label" = EXCLUDED."label", "style" = EXCLUDED."style"
      WHERE "ItemConnection"."label" IS DISTINCT FROM EXCLUDED."label"
        OR "ItemConnection"."style" IS DISTINCT FROM EXCLUDED."style";
  ELSE
    DELETE FROM "ItemConnection"
    WHERE "canvasId" = p_canvas AND "fromId" = p_from AND "toId" = p_to;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION memoria_canvas_item_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A removed endpoint takes its rows with it (foreign-key cascade).
    IF OLD."type" = 'ARROW' THEN
      PERFORM memoria_sync_arrow_link(
        OLD."canvasId", OLD."content"->>'startItemId', OLD."content"->>'endItemId');
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW."canvasId" IS NOT DISTINCT FROM OLD."canvasId"
    AND NEW."deletedAt" IS NOT DISTINCT FROM OLD."deletedAt"
    AND NEW."type" = OLD."type"
    AND (
      NEW."type" <> 'ARROW' OR (
        NEW."content"->>'startItemId' IS NOT DISTINCT FROM OLD."content"->>'startItemId'
        AND NEW."content"->>'endItemId' IS NOT DISTINCT FROM OLD."content"->>'endItemId'
        AND NEW."content"->>'label' IS NOT DISTINCT FROM OLD."content"->>'label'
        AND NEW."content"->>'lineStyle' IS NOT DISTINCT FROM OLD."content"->>'lineStyle'
      )
    )
  THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."type" = 'ARROW' THEN
    PERFORM memoria_sync_arrow_link(
      OLD."canvasId", OLD."content"->>'startItemId', OLD."content"->>'endItemId');
  END IF;

  IF NEW."type" = 'ARROW' THEN
    PERFORM memoria_sync_arrow_link(
      NEW."canvasId", NEW."content"->>'startItemId', NEW."content"->>'endItemId');
  ELSE
    -- An endpoint was created, trashed, restored or moved to another canvas:
    -- re-check the arrows that point at it, where it was and where it is.
    FOR r IN
      SELECT DISTINCT a."canvasId" AS canvas_id,
        a."content"->>'startItemId' AS from_id,
        a."content"->>'endItemId' AS to_id
      FROM "CanvasItem" a
      WHERE a."type" = 'ARROW'
        AND a."deletedAt" IS NULL
        AND (a."canvasId" = NEW."canvasId"
          OR (TG_OP = 'UPDATE' AND a."canvasId" = OLD."canvasId"))
        AND (a."content"->>'startItemId' = NEW."id"
          OR a."content"->>'endItemId' = NEW."id")
    LOOP
      PERFORM memoria_sync_arrow_link(r.canvas_id, r.from_id, r.to_id);
    END LOOP;
    IF TG_OP = 'UPDATE' AND OLD."canvasId" IS DISTINCT FROM NEW."canvasId" THEN
      DELETE FROM "ItemConnection"
      WHERE "canvasId" = OLD."canvasId"
        AND ("fromId" = NEW."id" OR "toId" = NEW."id");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "CanvasItem_links_insert_delete"
AFTER INSERT OR DELETE ON "CanvasItem"
FOR EACH ROW EXECUTE FUNCTION memoria_canvas_item_links();

-- Position-only writes (the most frequent) never fire it.
CREATE TRIGGER "CanvasItem_links_update"
AFTER UPDATE OF "canvasId", "deletedAt", "type", "content" ON "CanvasItem"
FOR EACH ROW EXECUTE FUNCTION memoria_canvas_item_links();

-- Links from arrows that already name two items.
INSERT INTO "ItemConnection" ("id", "canvasId", "fromId", "toId", "label", "style", "createdAt")
SELECT DISTINCT ON (a."canvasId", a."content"->>'startItemId', a."content"->>'endItemId')
  'lnk' || replace(gen_random_uuid()::text, '-', ''),
  a."canvasId", a."content"->>'startItemId', a."content"->>'endItemId',
  NULLIF(btrim(a."content"->>'label'), ''),
  COALESCE(a."content"->>'lineStyle', 'SOLID'), CURRENT_TIMESTAMP
FROM "CanvasItem" a
JOIN "CanvasItem" f ON f."id" = a."content"->>'startItemId'
  AND f."canvasId" = a."canvasId" AND f."deletedAt" IS NULL AND f."type" <> 'ARROW'
JOIN "CanvasItem" t ON t."id" = a."content"->>'endItemId'
  AND t."canvasId" = a."canvasId" AND t."deletedAt" IS NULL AND t."type" <> 'ARROW'
WHERE a."type" = 'ARROW' AND a."deletedAt" IS NULL
  AND a."content"->>'startItemId' <> a."content"->>'endItemId'
ORDER BY a."canvasId", a."content"->>'startItemId', a."content"->>'endItemId', a."createdAt", a."id"
ON CONFLICT ("canvasId", "fromId", "toId") DO NOTHING;

-- Links made without an arrow (the old connections API) become arrows in a
-- background job that records them as canvas events, so open documents and
-- clients see them. Keyed and safe to run twice.
INSERT INTO "OutboxJob" ("id", "type", "payload", "dedupeKey", "updatedAt")
VALUES (
  'imp095-arrow-links-backfill',
  'canvas.links.backfill',
  '{}'::jsonb,
  'canvas.links.backfill:start',
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;
