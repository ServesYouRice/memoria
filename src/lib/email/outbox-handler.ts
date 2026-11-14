import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { decryptSecret } from "@/lib/agents/crypto";
import {
  sendEmail,
  sendEmailVerification,
  sendPasswordResetEmail,
} from "@/lib/email";
import { env } from "@/lib/env";
import {
  shareDecisionTemplate,
  shareInvitationTemplate,
} from "@/lib/email/templates";

const payloadSchema = z.object({ verificationId: z.string().cuid() }).strict();

const deliveryProbePayloadSchema = z
  .object({ to: z.string().email() })
  .strict();

export function createDeliveryProbeEmailHandler(
  send = sendEmail,
): OutboxHandler {
  return async (job, context) => {
    const { to } = deliveryProbePayloadSchema.parse(job.payload);
    await send({
      to: { email: to },
      subject: "Memoria delivery probe",
      text: `Memoria successfully delivered the controlled setup probe. Delivery ID: ${job.id}`,
      html: `<p>Memoria successfully delivered the controlled setup probe.</p><p>Delivery ID: <code>${job.id}</code></p>`,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}

export function createVerificationEmailHandler(
  prisma: PrismaClient,
  send = sendEmailVerification,
): OutboxHandler {
  return async (job, context) => {
    const { verificationId } = payloadSchema.parse(job.payload);
    const verification = await prisma.emailVerificationToken.findUnique({
      where: { id: verificationId },
      select: {
        email: true,
        expiresAt: true,
        usedAt: true,
        deliverySecret: true,
      },
    });
    if (
      !verification ||
      verification.usedAt ||
      verification.expiresAt <= new Date()
    )
      return;
    if (!verification.deliverySecret)
      throw new Error("Verification delivery secret is unavailable.");
    const user = await prisma.user.findUnique({
      where: { email: verification.email },
      select: { name: true },
    });
    const raw = decryptSecret(verification.deliverySecret);
    await send(
      { email: verification.email, name: user?.name || undefined },
      {
        userName: user?.name || "User",
        verificationUrl: `${env.AUTH_URL}/auth/verify-email?token=${raw}`,
        expiresIn: "24 hours",
      },
      job.id,
      context?.signal,
    );
  };
}

export const PASSWORD_RESET_EMAIL_JOB = "email.password-reset";
/** Matches the forgot-password route's token lifetime. */
const PASSWORD_RESET_EXPIRES_IN = "1 hour";

const passwordResetPayloadSchema = z
  .object({ resetTokenId: z.string().cuid() })
  .strict();

/**
 * Password-reset mail (IMP-152). The job names the token row; the raw token
 * is kept encrypted on it (deliverySecret) until delivery and never enters
 * the payload. A delivered, used or expired token is a finished job. The
 * provider gets the job id as its idempotency key, which covers a retry
 * after a send whose `deliveredAt` write was lost.
 */
export function createPasswordResetEmailHandler(
  prisma: PrismaClient,
  send = sendPasswordResetEmail,
): OutboxHandler {
  return async (job, context) => {
    const { resetTokenId } = passwordResetPayloadSchema.parse(job.payload);
    const reset = await prisma.passwordResetToken.findUnique({
      where: { id: resetTokenId },
      select: {
        email: true,
        expiresAt: true,
        usedAt: true,
        deliveredAt: true,
        deliverySecret: true,
      },
    });
    if (
      !reset ||
      reset.deliveredAt ||
      reset.usedAt ||
      reset.expiresAt <= new Date()
    )
      return;
    if (!reset.deliverySecret)
      throw new Error("Password reset delivery secret is unavailable.");
    const user = await prisma.user.findUnique({
      where: { email: reset.email },
      select: { name: true },
    });
    if (!user) return;
    const raw = decryptSecret(reset.deliverySecret);
    await send(
      { email: reset.email, name: user.name || undefined },
      {
        userName: user.name || "User",
        resetUrl: `${env.AUTH_URL}/auth/reset-password?token=${raw}`,
        expiresIn: PASSWORD_RESET_EXPIRES_IN,
      },
      job.id,
      context?.signal,
    );
    // A repeated run finds it delivered; the raw token is no longer needed.
    await prisma.passwordResetToken.updateMany({
      where: { id: resetTokenId, deliveredAt: null },
      data: { deliveredAt: new Date(), deliverySecret: null },
    });
  };
}

const invitationPayloadSchema = z
  .object({ invitationId: z.string().cuid() })
  .strict();

export function createShareInvitationEmailHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const { invitationId } = invitationPayloadSchema.parse(job.payload);
    const invitation = await prisma.canvasShareInvitation.findUnique({
      where: { id: invitationId },
      include: {
        canvas: { select: { name: true, deletedAt: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (
      !invitation ||
      invitation.respondedAt ||
      invitation.expiresAt <= new Date() ||
      // No invitation goes out for a canvas in Trash (IMP-132).
      invitation.canvas.deletedAt
    )
      return;
    const recipient = await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    if (recipient) {
      const preference = await prisma.notificationPreference.findUnique({
        where: {
          userId_type: {
            userId: recipient.id,
            type: "CANVAS_SHARED",
          },
        },
        select: { emailEnabled: true },
      });
      if (preference?.emailEnabled === false) return;
    }
    const rawToken = decryptSecret(invitation.deliverySecret);
    const template = shareInvitationTemplate({
      inviterName: invitation.invitedBy.name || invitation.invitedBy.email,
      canvasName: invitation.canvas.name,
      invitationUrl: `${env.AUTH_URL}/share-invitations/${rawToken}`,
      expiresIn: "7 days",
    });
    await sendEmail({
      to: { email: invitation.email },
      ...template,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}

export function createShareDecisionEmailHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const { invitationId } = invitationPayloadSchema.parse(job.payload);
    const invitation = await prisma.canvasShareInvitation.findUnique({
      where: { id: invitationId },
      include: {
        canvas: { select: { name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (!invitation?.response || invitation.response === "REVOKED") return;
    const preferenceType =
      invitation.response === "ACCEPTED"
        ? "SHARE_INVITATION_ACCEPTED"
        : "SHARE_INVITATION_DECLINED";
    const preference = await prisma.notificationPreference.findUnique({
      where: {
        userId_type: {
          userId: invitation.invitedById,
          type: preferenceType,
        },
      },
      select: { emailEnabled: true },
    });
    if (preference?.emailEnabled === false) return;
    const template = shareDecisionTemplate({
      recipientEmail: invitation.email,
      canvasName: invitation.canvas.name,
      decision: invitation.response === "ACCEPTED" ? "accepted" : "declined",
    });
    await sendEmail({
      to: {
        email: invitation.invitedBy.email,
        name: invitation.invitedBy.name || undefined,
      },
      ...template,
      deliveryId: job.id,
      signal: context?.signal,
    });
  };
}
