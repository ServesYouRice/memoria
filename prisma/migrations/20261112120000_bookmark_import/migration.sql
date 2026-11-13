-- IMP-091: background bookmark imports.
CREATE TYPE "BookmarkImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE "BookmarkImportDestination" AS ENUM ('INBOX', 'FOLDERS');

CREATE TABLE "BookmarkImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BookmarkImportStatus" NOT NULL DEFAULT 'QUEUED',
    "destination" "BookmarkImportDestination" NOT NULL,
    "enrich" BOOLEAN NOT NULL DEFAULT false,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "links" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "overLimit" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "folderCanvases" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookmarkImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BookmarkImport_userId_createdAt_idx" ON "BookmarkImport"("userId", "createdAt");

ALTER TABLE "BookmarkImport" ADD CONSTRAINT "BookmarkImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
