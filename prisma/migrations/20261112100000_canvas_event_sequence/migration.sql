-- A contiguous per-canvas number for committed item events, next to the
-- global "sequence" (owner decision for TASK-020 / TASK-188). Writers take it
-- with UPDATE "Canvas" SET "eventSequence" = ... RETURNING in the inserting
-- transaction, which also serializes one canvas's event inserts in commit
-- order. 'restored' events are not item events and keep NULL.
ALTER TABLE "Canvas" ADD COLUMN "eventSequence" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "CanvasEvent" ADD COLUMN "canvasSequence" BIGINT;

UPDATE "CanvasEvent" AS e
SET "canvasSequence" = numbered.n
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "canvasId" ORDER BY "sequence") AS n
  FROM "CanvasEvent"
  WHERE "operation" <> 'restored'
) AS numbered
WHERE e."id" = numbered."id";

UPDATE "Canvas" AS c
SET "eventSequence" = latest.n
FROM (
  SELECT "canvasId", MAX("canvasSequence") AS n
  FROM "CanvasEvent"
  WHERE "canvasSequence" IS NOT NULL
  GROUP BY "canvasId"
) AS latest
WHERE c."id" = latest."canvasId";

CREATE UNIQUE INDEX "CanvasEvent_canvasId_canvasSequence_key"
  ON "CanvasEvent"("canvasId", "canvasSequence");
