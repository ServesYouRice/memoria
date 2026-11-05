-- IMP-071: an upload remembers the text note made from it.
ALTER TABLE "UploadAsset" ADD COLUMN "noteItemId" TEXT;
