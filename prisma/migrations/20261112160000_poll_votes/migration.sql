-- IMP-104: poll votes counted on the server, and polls the owner closed.

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollClosure" (
    "itemId" TEXT NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollClosure_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE INDEX "PollVote_itemId_choiceId_idx" ON "PollVote"("itemId", "choiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_itemId_userId_choiceId_key" ON "PollVote"("itemId", "userId", "choiceId");

-- CreateIndex
CREATE INDEX "PollClosure_closedById_idx" ON "PollClosure"("closedById");

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollClosure" ADD CONSTRAINT "PollClosure_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollClosure" ADD CONSTRAINT "PollClosure_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

