-- IMP-132: a deleted canvas goes to Trash for 30 days before the sweep purges it.
ALTER TABLE "Canvas" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

CREATE INDEX "Canvas_userId_deletedAt_idx" ON "Canvas"("userId", "deletedAt");
