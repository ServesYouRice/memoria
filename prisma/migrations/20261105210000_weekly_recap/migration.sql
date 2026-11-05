-- IMP-070: weekly recap and tidy-up of old links. Opening a link is recorded,
-- archived items stay in the trash without being swept, and one recap row per
-- user and ISO week makes the scheduled job safe to run twice.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WEEKLY_RECAP';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "weeklyRecapEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "staleLinkWeeks" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "CanvasItem" ADD COLUMN "lastOpenedAt" TIMESTAMP(3),
ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WeeklyRecap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "savedLinks" JSONB NOT NULL,
    "suggestedPiles" JSONB NOT NULL,
    "staleWeeks" INTEGER NOT NULL,
    "staleCount" INTEGER NOT NULL DEFAULT 0,
    "staleItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notificationId" TEXT,
    "emailQueued" BOOLEAN NOT NULL DEFAULT false,
    "archivedChangeSetId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyRecap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyRecap_userId_createdAt_idx" ON "WeeklyRecap"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyRecap_userId_weekStart_key" ON "WeeklyRecap"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "WeeklyRecap" ADD CONSTRAINT "WeeklyRecap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
