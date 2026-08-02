CREATE TYPE "ShareInvitationResponse" AS ENUM ('ACCEPTED', 'DECLINED', 'REVOKED');
CREATE TYPE "NotificationType" AS ENUM ('SHARE_INVITATION_ACCEPTED', 'SHARE_INVITATION_DECLINED', 'CANVAS_SHARED');

ALTER TABLE "CanvasShare" ADD COLUMN "recipientId" TEXT;
UPDATE "CanvasShare" share SET "recipientId" = users."id"
FROM "User" users WHERE lower(users."email") = lower(share."email");

CREATE TABLE "CanvasShareInvitation" (
  "id" TEXT NOT NULL,
  "canvasId" TEXT NOT NULL,
  "invitedById" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "ShareRole" NOT NULL DEFAULT 'VIEW',
  "tokenHash" TEXT NOT NULL,
  "deliverySecret" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "response" "ShareInvitationResponse",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasShareInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "canvasId" TEXT,
  "type" "NotificationType" NOT NULL,
  "subject" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvasShare_canvasId_recipientId_key" ON "CanvasShare"("canvasId", "recipientId") WHERE "recipientId" IS NOT NULL;
CREATE UNIQUE INDEX "CanvasShareInvitation_tokenHash_key" ON "CanvasShareInvitation"("tokenHash");
CREATE INDEX "CanvasShareInvitation_canvasId_email_respondedAt_idx" ON "CanvasShareInvitation"("canvasId", "email", "respondedAt");
CREATE INDEX "CanvasShareInvitation_expiresAt_respondedAt_idx" ON "CanvasShareInvitation"("expiresAt", "respondedAt");
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

ALTER TABLE "CanvasShare" ADD CONSTRAINT "CanvasShare_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasShareInvitation" ADD CONSTRAINT "CanvasShareInvitation_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasShareInvitation" ADD CONSTRAINT "CanvasShareInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
