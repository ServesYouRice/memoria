-- IMP-153: the owner issues sign-up invites; the invite email reads the link
-- from this encrypted column. Expand-only.
ALTER TABLE "RegistrationInvite" ADD COLUMN "deliverySecret" TEXT;
