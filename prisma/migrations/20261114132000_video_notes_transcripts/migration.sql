-- IMP-114: notes tied to moments of a video, and video transcripts.

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('PASTED', 'FETCHED');

-- CreateTable
CREATE TABLE "ItemVideoNote" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemVideoNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTranscript" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textBytes" INTEGER NOT NULL DEFAULT 0,
    "source" "TranscriptSource" NOT NULL,
    "language" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemTranscript_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE INDEX "ItemVideoNote_itemId_seconds_idx" ON "ItemVideoNote"("itemId", "seconds");

-- CreateIndex
CREATE INDEX "ItemTranscript_userId_idx" ON "ItemTranscript"("userId");

-- CreateIndex
CREATE INDEX "idx_item_transcript_fts" ON "ItemTranscript" USING GIN ("searchVector");

-- AddForeignKey
ALTER TABLE "ItemVideoNote" ADD CONSTRAINT "ItemVideoNote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTranscript" ADD CONSTRAINT "ItemTranscript_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
