-- IMP-055: the base64 Canvas.thumbnail column is no longer written or read; thumbnails live in object storage (thumbnailKey) and the outbox installs them. Migration 20260729203000 already cleared its values.
ALTER TABLE "Canvas" DROP COLUMN "thumbnail";
