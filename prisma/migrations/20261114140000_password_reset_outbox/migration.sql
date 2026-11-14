-- IMP-152: password-reset mail is sent by the outbox. The raw token is kept
-- encrypted until the job delivers it; deliveredAt makes a repeated job a no-op.
ALTER TABLE "PasswordResetToken" ADD COLUMN "deliverySecret" TEXT,
ADD COLUMN "deliveredAt" TIMESTAMP(3);
