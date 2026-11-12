-- IMP-097: "Remind me" on an item.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ITEM_REMINDER';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "itemId" TEXT;

-- CreateTable
CREATE TABLE "ItemReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "firedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemReminder_remindAt_idx" ON "ItemReminder"("remindAt");

-- CreateIndex
CREATE INDEX "ItemReminder_userId_remindAt_idx" ON "ItemReminder"("userId", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemReminder_userId_itemId_key" ON "ItemReminder"("userId", "itemId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemReminder" ADD CONSTRAINT "ItemReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemReminder" ADD CONSTRAINT "ItemReminder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
